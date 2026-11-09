import "dotenv/config";

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import AdmZip from "adm-zip";
import { chromium } from "playwright";
import { Agent, fetch, FormData } from "undici";

/*
 * Daily sync Efactsoft -> PragmaCRM. Asks the API for the range to export
 * (GET /uploads/sales/sync-range), downloads it from Efactsoft and uploads it
 * to POST /uploads/sales, the same endpoint the dashboard uses.
 *
 *   npm run efactsoft:sync                         # normal daily run
 *   npm run efactsoft:sync -- --dry-run            # download and check, no upload
 *   npm run efactsoft:sync -- --from 2026-09-01 --to 2026-09-30
 *   npm run efactsoft:sync -- --save ./export.json # keep a copy of the JSON
 */

const DEFAULT_LOGIN_URL = "https://distdemedicamentos.efactsoft.com/login";
const DEFAULT_SALES_URL = "https://distdemedicamentos.efactsoft.com/iv/sales";
const IMPORT_POLL_INTERVAL_MS = 30_000;
const IMPORT_WAIT_LIMIT_MS = 20 * 60_000;
const UPLOAD_ATTEMPTS = 3;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface SalesSyncRange {
  from: string;
  to: string;
  oldest_pending_date: string | null;
  pending_sales: number;
  pending_outside_range: number;
  max_lookback_days: number;
}

interface ImportInProgressStatus {
  in_progress: boolean;
  upload_id: string | null;
  status: string | null;
}

interface ImportSalesResult {
  upload_id: string;
  rejected: number;
  sync_failed: number;
  rejections: { index: number; erp_sale_id: number | null; reason: string }[];
}

class PragmaApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(`PragmaCRM API responded ${status}: ${message}`);
  }
}

const log = (message: string): void => {
  console.log(`[${new Date().toISOString()}] ${message}`);
};

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
};

const parseArgs = (argv: string[]) => {
  const valueOf = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    if (index === -1) return undefined;
    const value = argv[index + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`${flag} needs a value`);
    return value;
  };

  const options = {
    dryRun: argv.includes("--dry-run"),
    from: valueOf("--from"),
    to: valueOf("--to"),
    savePath: valueOf("--save") ?? process.env.EFACTSOFT_SAVE_PATH,
  };

  for (const date of [options.from, options.to]) {
    if (date && !ISO_DATE.test(date))
      throw new Error(`Expected YYYY-MM-DD, got "${date}"`);
  }
  if (options.to && !options.from) throw new Error("--to requires --from");
  if (options.from && options.to && options.from > options.to) {
    throw new Error(`--from ${options.from} is after --to ${options.to}`);
  }
  return options;
};

const todayInElSalvador = (): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.BUSINESS_TIMEZONE || "America/El_Salvador",
  }).format(new Date());

const config = () => ({
  baseUrl: requireEnv("PRAGMA_API_URL").replace(/\/+$/, ""),
  apiKey: requireEnv("API_KEY"),
  supabaseUrl: requireEnv("SUPABASE_URL").replace(/\/+$/, ""),
  supabaseAnonKey: requireEnv("SUPABASE_ANON_KEY"),
  adminEmail: requireEnv("SYNC_ADMIN_EMAIL"),
  adminPassword: requireEnv("SYNC_ADMIN_PASSWORD"),
  efactsoftUser: requireEnv("EFACTSOFT_USER"),
  efactsoftPassword: requireEnv("EFACTSOFT_PASSWORD"),
  efactsoftLoginUrl: process.env.EFACTSOFT_LOGIN_URL || DEFAULT_LOGIN_URL,
  efactsoftSalesUrl: process.env.EFACTSOFT_SALES_URL || DEFAULT_SALES_URL,
  headless: process.env.HEADLESS !== "false",
  uploadTimeoutMs:
    Number(process.env.SYNC_UPLOAD_TIMEOUT_MINUTES ?? 30) * 60_000,
});
type Config = ReturnType<typeof config>;

// The import only answers when it finishes, past undici's default 300 s headers timeout.
const longRequestAgent = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

const loginAdmin = async (cfg: Config): Promise<string> => {
  const response = await fetch(
    `${cfg.supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: cfg.supabaseAnonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: cfg.adminEmail,
        password: cfg.adminPassword,
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    error_description?: string;
    msg?: string;
  };
  if (!response.ok || !body.access_token) {
    throw new Error(
      `Supabase login failed (${response.status}): ${body.error_description ?? body.msg ?? "no access token"}`,
    );
  }
  return body.access_token;
};

const callApi = async <T>(
  cfg: Config,
  token: string,
  path: string,
  init: { method?: string; body?: FormData; timeoutMs?: number } = {},
): Promise<{ message: string; data: T }> => {
  const response = await fetch(`${cfg.baseUrl}/api/v1${path}`, {
    method: init.method ?? "GET",
    headers: { "x-api-key": cfg.apiKey, Authorization: `Bearer ${token}` },
    body: init.body,
    dispatcher: longRequestAgent,
    signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
  });
  const body = (await response.json().catch(() => ({}))) as {
    message?: string;
    data?: T;
  };
  if (!response.ok)
    throw new PragmaApiError(
      response.status,
      body.message ?? response.statusText,
    );
  return { message: body.message ?? "", data: body.data as T };
};

const toEfactsoftDate = (isoDate: string): string =>
  isoDate.split("-").reverse().join("/");

// Efactsoft sends venta.created_at as `dd/MM/yyyy HH:mm:ss`, sometimes as `yyyy-MM-dd ...`.
const readCreatedDate = (sale: unknown): string | null => {
  const value = (sale as { venta?: { created_at?: unknown } })?.venta
    ?.created_at;
  if (typeof value !== "string") return null;
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(value);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return ymd ? `${ymd[1]}-${ymd[2]}-${ymd[3]}` : null;
};

const downloadSalesExport = async (
  cfg: Config,
  from: string,
  to: string,
): Promise<Buffer> => {
  const browser = await chromium.launch({ headless: cfg.headless });
  const page = await browser.newPage();
  page.setDefaultTimeout(60_000);

  try {
    await page.goto(cfg.efactsoftLoginUrl);
    await page.fill("#usuario", cfg.efactsoftUser);
    await page.fill("#password", cfg.efactsoftPassword);
    await page.click("button.auth-form-btn");
    await page
      .waitForURL((url) => !url.pathname.startsWith("/login"), {
        timeout: 30_000,
      })
      .catch(() => {
        throw new Error(
          "Efactsoft login failed: still on the login page. Check EFACTSOFT_USER / EFACTSOFT_PASSWORD.",
        );
      });
    await page.waitForLoadState("networkidle");

    await page.goto(cfg.efactsoftSalesUrl);
    await page.waitForLoadState("networkidle");
    await page.click("a.btn-filtrar");
    await page.fill(
      "#datefilter",
      `${toEfactsoftDate(from)} - ${toEfactsoftDate(to)}`,
    );
    await page.keyboard.press("Enter");
    await page.click('button:has-text("Buscar")');
    await page.waitForLoadState("networkidle");

    await page.waitForFunction(() => {
      const button = document.querySelector(
        "#export-json2",
      ) as HTMLElement | null;
      return Boolean(button?.dataset.url);
    });

    // A wide range takes Efactsoft a while to build the zip.
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 300_000 }),
      page.click("#export-json2"),
    ]);

    const chunks: Uint8Array[] = [];
    for await (const chunk of await download.createReadStream())
      chunks.push(chunk as Uint8Array);

    const jsonEntry = new AdmZip(Buffer.concat(chunks))
      .getEntries()
      .find((entry) => entry.entryName.endsWith(".json"));
    if (!jsonEntry)
      throw new Error("No .json file found inside the Efactsoft export zip");
    return jsonEntry.getData();
  } catch (error) {
    const screenshot = join(tmpdir(), `efactsoft-sync-error-${Date.now()}.png`);
    const saved = await page
      .screenshot({ path: screenshot, fullPage: true })
      .then(
        () => true,
        () => false,
      );
    if (saved) (error as Error).message += ` (screenshot: ${screenshot})`;
    throw error;
  } finally {
    await browser.close();
  }
};

const waitForIdleImport = async (cfg: Config, token: string): Promise<void> => {
  const deadline = Date.now() + IMPORT_WAIT_LIMIT_MS;
  for (;;) {
    const { data: status } = await callApi<ImportInProgressStatus>(
      cfg,
      token,
      "/uploads/sales/in-progress",
    );
    if (!status.in_progress) return;
    if (Date.now() > deadline) {
      throw new Error(
        `An import is still running after ${IMPORT_WAIT_LIMIT_MS / 60_000} min (upload ${status.upload_id ?? "unknown"})`,
      );
    }
    log(
      `Another import is in progress (upload ${status.upload_id ?? "unknown"}, ${status.status ?? "starting"}); waiting...`,
    );
    await sleep(IMPORT_POLL_INTERVAL_MS);
  }
};

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));
  const cfg = config();

  let token = await loginAdmin(cfg);

  let from: string;
  let to: string;
  if (options.from) {
    from = options.from;
    to = options.to ?? todayInElSalvador();
    log(`Using the range from the command line: ${from} -> ${to}`);
  } else {
    const { data: range } = await callApi<SalesSyncRange>(
      cfg,
      token,
      "/uploads/sales/sync-range",
    );
    ({ from, to } = range);
    log(
      `Range from the API: ${from} -> ${to} (${range.pending_sales} sales with pending balance, ` +
        `oldest ${range.oldest_pending_date ?? "none"})`,
    );
    if (range.pending_outside_range > 0) {
      log(
        `WARNING: ${range.pending_outside_range} sales with pending balance are older than ` +
          `${range.max_lookback_days} days and will not be refreshed.`,
      );
    }
  }

  log("Downloading the export from Efactsoft...");
  const json = await downloadSalesExport(cfg, from, to);

  const sales: unknown = JSON.parse(json.toString("utf-8"));
  if (!Array.isArray(sales))
    throw new Error("The Efactsoft export is not a JSON array of sales");

  const outsideRange = sales.filter((sale) => {
    const day = readCreatedDate(sale);
    return !day || day < from || day > to;
  }).length;
  log(
    `Downloaded ${sales.length} sales (${(json.length / 1024 / 1024).toFixed(1)} MB)`,
  );

  if (options.savePath) {
    writeFileSync(options.savePath, json.toString("utf-8"));
    log(`Saved a copy to ${options.savePath}`);
  }

  // The import reconciles (soft-deletes) the whole range, so a file with other days would remove the wrong sales.
  if (outsideRange > 0) {
    throw new Error(
      `${outsideRange} sales fall outside ${from} -> ${to} or have no created_at; ` +
        "the date filter probably did not apply. Nothing was uploaded.",
    );
  }
  if (sales.length === 0) {
    log("Efactsoft returned no sales for the range; nothing to upload.");
    return;
  }
  if (options.dryRun) {
    log("--dry-run: skipping the upload.");
    return;
  }

  // The download can take minutes; start the upload with a fresh token.
  token = await loginAdmin(cfg);
  const filename = `efactsoft-${from}_${to}.json`;

  for (let attempt = 1; ; attempt += 1) {
    await waitForIdleImport(cfg, token);
    log(`Uploading ${filename} (attempt ${attempt}/${UPLOAD_ATTEMPTS})...`);
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(json)], { type: "application/json" }),
      filename,
    );
    try {
      const { message, data } = await callApi<ImportSalesResult>(
        cfg,
        token,
        "/uploads/sales",
        {
          method: "POST",
          body: form,
          timeoutMs: cfg.uploadTimeoutMs,
        },
      );
      log(`Import finished: ${message}`);
      log(
        `upload_id=${data.upload_id} rejected=${data.rejected} sync_failed=${data.sync_failed}`,
      );
      for (const rejection of data.rejections.slice(0, 20)) {
        log(
          `  rejected #${rejection.index} (id_venta ${rejection.erp_sale_id ?? "?"}): ${rejection.reason}`,
        );
      }
      return;
    } catch (error) {
      // 409: another import took the lock between our check and the POST.
      if (
        error instanceof PragmaApiError &&
        error.status === 409 &&
        attempt < UPLOAD_ATTEMPTS
      ) {
        log("The API reported an import in progress (409); retrying.");
        continue;
      }
      if (!(error instanceof PragmaApiError)) {
        log(
          "The upload request failed without a response; the import may still be running on the server.",
        );
      }
      throw error;
    }
  }
};

main().catch((error: unknown) => {
  log(`Sync failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
