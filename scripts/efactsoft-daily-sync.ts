import 'dotenv/config';

import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

import { downloadSalesExport, summarizeExport } from './lib/efactsoft-export';
import {
  getImportInProgress,
  getSalesSyncRange,
  loginAdmin,
  PragmaApiConfig,
  PragmaApiError,
  uploadSalesFile,
} from './lib/pragma-api';

/*
 * Daily sync Efactsoft -> PragmaCRM. Asks the API which quotation-date range
 * to export (GET /uploads/sales/sync-range), downloads it from Efactsoft and
 * uploads it through the same endpoint the dashboard uses (POST
 * /uploads/sales). See README "Sincronización diaria con Efactsoft".
 *
 *   npm run efactsoft:sync                         # normal daily run
 *   npm run efactsoft:sync -- --dry-run            # download and check, no upload
 *   npm run efactsoft:sync -- --from 2026-09-01 --to 2026-09-30
 *   npm run efactsoft:sync -- --save ./export.json # keep a copy of the JSON
 */

const IMPORT_POLL_INTERVAL_MS = 30_000;
const IMPORT_WAIT_LIMIT_MS = 20 * 60_000;
const UPLOAD_ATTEMPTS = 3;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const log = (message: string): void => {
  console.log(`[${new Date().toISOString()}] ${message}`);
};

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
};

interface CliOptions {
  dryRun: boolean;
  from?: string;
  to?: string;
  savePath?: string;
}

const parseArgs = (argv: string[]): CliOptions => {
  const valueOf = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    if (index === -1) return undefined;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    return value;
  };

  const options: CliOptions = {
    dryRun: argv.includes('--dry-run'),
    from: valueOf('--from'),
    to: valueOf('--to'),
    savePath: valueOf('--save') ?? process.env.EFACTSOFT_SAVE_PATH,
  };

  for (const date of [options.from, options.to]) {
    if (date && !ISO_DATE.test(date)) throw new Error(`Expected YYYY-MM-DD, got "${date}"`);
  }
  if (options.to && !options.from) throw new Error('--to requires --from');
  if (options.from && options.to && options.from > options.to) {
    throw new Error(`--from ${options.from} is after --to ${options.to}`);
  }
  return options;
};

const todayInElSalvador = (): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.BUSINESS_TIMEZONE || 'America/El_Salvador',
  }).format(new Date());

const waitForIdleImport = async (api: PragmaApiConfig, token: string): Promise<void> => {
  const deadline = Date.now() + IMPORT_WAIT_LIMIT_MS;
  for (;;) {
    const status = await getImportInProgress(api, token);
    if (!status.in_progress) return;
    if (Date.now() > deadline) {
      throw new Error(`An import is still running after ${IMPORT_WAIT_LIMIT_MS / 60_000} min (upload ${status.upload_id ?? 'unknown'})`);
    }
    log(`Another import is in progress (upload ${status.upload_id ?? 'unknown'}, ${status.status ?? 'starting'}); waiting...`);
    await sleep(IMPORT_POLL_INTERVAL_MS);
  }
};

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));

  const api: PragmaApiConfig = {
    baseUrl: requireEnv('PRAGMA_API_URL').replace(/\/+$/, ''),
    apiKey: requireEnv('API_KEY'),
    supabaseUrl: requireEnv('SUPABASE_URL').replace(/\/+$/, ''),
    supabaseAnonKey: requireEnv('SUPABASE_ANON_KEY'),
    adminEmail: requireEnv('SYNC_ADMIN_EMAIL'),
    adminPassword: requireEnv('SYNC_ADMIN_PASSWORD'),
  };
  const efactsoft = {
    user: requireEnv('EFACTSOFT_USER'),
    password: requireEnv('EFACTSOFT_PASSWORD'),
    loginUrl: process.env.EFACTSOFT_LOGIN_URL,
    salesUrl: process.env.EFACTSOFT_SALES_URL,
    headless: process.env.HEADLESS !== 'false',
  };
  const uploadTimeoutMs = Number(process.env.SYNC_UPLOAD_TIMEOUT_MINUTES ?? 30) * 60_000;

  let token = await loginAdmin(api);

  let from: string;
  let to: string;
  if (options.from) {
    from = options.from;
    to = options.to ?? todayInElSalvador();
    log(`Using the range from the command line: ${from} -> ${to}`);
  } else {
    const range = await getSalesSyncRange(api, token);
    ({ from, to } = range);
    log(
      `Range from the API: ${from} -> ${to} (${range.pending_sales} sales with pending balance, ` +
        `oldest ${range.oldest_pending_date ?? 'none'})`
    );
    if (range.pending_outside_range > 0) {
      log(
        `WARNING: ${range.pending_outside_range} sales with pending balance are older than ` +
          `${range.max_lookback_days} days and will not be refreshed (SALES_SYNC_MAX_LOOKBACK_DAYS).`
      );
    }
  }

  log('Downloading the export from Efactsoft...');
  const json = await downloadSalesExport(efactsoft, from, to);

  const sales: unknown = JSON.parse(json.toString('utf-8'));
  if (!Array.isArray(sales)) throw new Error('The Efactsoft export is not a JSON array of sales');

  const summary = summarizeExport(sales, from, to);
  log(
    `Downloaded ${summary.sales} sales (${(json.length / 1024 / 1024).toFixed(1)} MB), ` +
      `created ${summary.created_from ?? '-'} -> ${summary.created_to ?? '-'}`
  );

  if (options.savePath) {
    writeFileSync(options.savePath, json.toString('utf-8'));
    log(`Saved a copy to ${options.savePath}`);
  }

  // Uploading a file with days we did not ask for would reconcile (soft-delete)
  // the wrong range in the CRM.
  if (summary.outside_range > 0) {
    throw new Error(
      `${summary.outside_range} sales fall outside ${from} -> ${to} or have no created_at; ` +
        'the date filter probably did not apply. Nothing was uploaded.'
    );
  }
  if (sales.length === 0) {
    log('Efactsoft returned no sales for the range; nothing to upload.');
    return;
  }
  if (options.dryRun) {
    log('--dry-run: skipping the upload.');
    return;
  }

  // The download can take minutes; start the upload with a fresh token.
  token = await loginAdmin(api);
  const filename = `efactsoft-${from}_${to}.json`;

  for (let attempt = 1; ; attempt += 1) {
    await waitForIdleImport(api, token);
    log(`Uploading ${filename} (attempt ${attempt}/${UPLOAD_ATTEMPTS})...`);
    try {
      const { message, data } = await uploadSalesFile(api, token, json, filename, uploadTimeoutMs);
      log(`Import finished: ${message}`);
      log(`upload_id=${data.upload_id} rejected=${data.rejected} sync_failed=${data.sync_failed}`);
      for (const rejection of data.rejections.slice(0, 20)) {
        log(`  rejected #${rejection.index} (id_venta ${rejection.erp_sale_id ?? '?'}): ${rejection.reason}`);
      }
      return;
    } catch (error) {
      // 409: another import took the lock between our check and the POST.
      if (error instanceof PragmaApiError && error.status === 409 && attempt < UPLOAD_ATTEMPTS) {
        log('The API reported an import in progress (409); retrying.');
        continue;
      }
      if (!(error instanceof PragmaApiError)) {
        // The server keeps importing after the connection drops (PCRM-169).
        log('The upload request failed without a response; the import may still be running on the server.');
      }
      throw error;
    }
  }
};

main().catch((error: unknown) => {
  log(`Sync failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
