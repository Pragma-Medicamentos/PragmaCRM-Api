import AdmZip from 'adm-zip';
import { DateTime } from 'luxon';
import { chromium } from 'playwright';

import { ERP_TIMEZONE } from '../../src/lib/parseErpDate';
import { ErpSale } from './summarize-yesterday-sales';

const DEFAULT_LOGIN_URL = 'https://distdemedicamentos.efactsoft.com/login';
const DEFAULT_SALES_URL = 'https://distdemedicamentos.efactsoft.com/iv/sales';

const resolveEnv = (name: string, fallback: string): string => process.env[name] || fallback;

/**
 * "dd/MM/yyyy - dd/MM/yyyy" for yesterday only, evaluated in
 * America/El_Salvador so the range matches the calendar day the
 * salesperson saw on the invoice, not the host machine's timezone.
 */
export const buildYesterdayDateRangeFilter = (
  now: DateTime = DateTime.now().setZone(ERP_TIMEZONE),
): string => {
  const yesterday = now.setZone(ERP_TIMEZONE).minus({ days: 1 }).toFormat('dd/MM/yyyy');
  return `${yesterday} - ${yesterday}`;
};

export interface DownloadYesterdaySalesOptions {
  /** Reference instant for "yesterday". Defaults to the current time. */
  now?: DateTime;
}

/**
 * Logs into Efactsoft, filters the sales list to yesterday only, and
 * downloads/unzips the JSON export. Mirrors the flow in
 * pragma-daily-staging's download-and-upload.js (branch modified-endpoint),
 * minus the upload to PragmaCRM-Api.
 */
export const downloadYesterdaySales = async (
  options: DownloadYesterdaySalesOptions = {},
): Promise<ErpSale[]> => {
  const user = process.env.CRM_USER;
  const password = process.env.CRM_PASSWORD;
  if (!user || !password) {
    throw new Error('CRM_USER and CRM_PASSWORD must be set to download from Efactsoft');
  }

  const loginUrl = resolveEnv('CRM_LOGIN_URL', DEFAULT_LOGIN_URL);
  const salesUrl = resolveEnv('CRM_SALES_URL', DEFAULT_SALES_URL);
  const headless = process.env.HEADLESS !== 'false';

  const browser = await chromium.launch({ headless });
  try {
    const page = await browser.newPage();

    await page.goto(loginUrl);
    await page.fill('#usuario', user);
    await page.fill('#password', password);
    await page.click('button.auth-form-btn');
    await page.waitForLoadState('networkidle');

    await page.goto(salesUrl);
    await page.waitForLoadState('networkidle');

    await page.click('a.btn-filtrar');

    await page.fill('#datefilter', buildYesterdayDateRangeFilter(options.now));
    await page.keyboard.press('Enter');

    await page.click('button:has-text("Buscar")');
    await page.waitForLoadState('networkidle');

    await page.waitForFunction(
      () => {
        const button = document.querySelector('#export-json2') as HTMLElement | null;
        return Boolean(button?.dataset.url && button.dataset.url.length > 0);
      },
      { timeout: 15000 },
    );

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#export-json2'),
    ]);

    const stream = await download.createReadStream();
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) chunks.push(chunk as Uint8Array);
    const zipBuffer = Buffer.concat(chunks);

    const zip = new AdmZip(zipBuffer);
    const jsonEntry = zip.getEntries().find((entry: AdmZip.IZipEntry) =>
      entry.entryName.endsWith('.json'),
    );
    if (!jsonEntry) {
      throw new Error('No .json file found inside the Efactsoft export zip');
    }

    const parsed: unknown = JSON.parse(jsonEntry.getData().toString('utf-8'));
    if (!Array.isArray(parsed)) {
      throw new Error(`Expected an array of sales from Efactsoft, got ${typeof parsed}`);
    }

    return parsed as ErpSale[];
  } finally {
    await browser.close();
  }
};
