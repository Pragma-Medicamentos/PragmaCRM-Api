import { tmpdir } from 'node:os';
import { join } from 'node:path';

import AdmZip from 'adm-zip';
import { chromium, Page } from 'playwright';

const DEFAULT_LOGIN_URL = 'https://distdemedicamentos.efactsoft.com/login';
const DEFAULT_SALES_URL = 'https://distdemedicamentos.efactsoft.com/iv/sales';

export interface EfactsoftCredentials {
  user: string;
  password: string;
  loginUrl?: string;
  salesUrl?: string;
  headless?: boolean;
}

/** `YYYY-MM-DD` (what the API returns) to the `dd/MM/yyyy` Efactsoft's filter expects. */
export const toEfactsoftDate = (isoDate: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error(`Expected a YYYY-MM-DD date, got "${isoDate}"`);
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
};

export const buildDateRangeFilter = (from: string, to: string): string =>
  `${toEfactsoftDate(from)} - ${toEfactsoftDate(to)}`;

/**
 * Local day of `venta.created_at` as `YYYY-MM-DD`. Efactsoft sends it as
 * `dd/MM/yyyy HH:mm:ss`; `yyyy-MM-dd HH:mm:ss` is accepted too because other
 * timestamps of the same payload use it (src/lib/parseErpDate.ts).
 */
export const readCreatedDate = (sale: unknown): string | null => {
  const value = (sale as { venta?: { created_at?: unknown } })?.venta?.created_at;
  if (typeof value !== 'string') return null;

  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(value);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;

  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return ymd ? `${ymd[1]}-${ymd[2]}-${ymd[3]}` : null;
};

export interface ExportSummary {
  sales: number;
  created_from: string | null;
  created_to: string | null;
  /** Sales whose `created_at` falls outside the requested range, or is unreadable. */
  outside_range: number;
}

/**
 * Checks the export against the range that was requested. If the date filter
 * silently failed to apply, Efactsoft exports its default range instead, and
 * uploading that would reconcile the wrong days.
 */
export const summarizeExport = (sales: unknown[], from: string, to: string): ExportSummary => {
  let createdFrom: string | null = null;
  let createdTo: string | null = null;
  let outsideRange = 0;

  for (const sale of sales) {
    const day = readCreatedDate(sale);
    if (!day || day < from || day > to) {
      outsideRange += 1;
      continue;
    }
    if (!createdFrom || day < createdFrom) createdFrom = day;
    if (!createdTo || day > createdTo) createdTo = day;
  }

  return { sales: sales.length, created_from: createdFrom, created_to: createdTo, outside_range: outsideRange };
};

const saveScreenshot = async (page: Page): Promise<string | null> => {
  const path = join(tmpdir(), `efactsoft-sync-error-${Date.now()}.png`);
  try {
    await page.screenshot({ path, fullPage: true });
    return path;
  } catch {
    return null;
  }
};

/**
 * Logs into Efactsoft, filters the sales list by quotation date (`created_at`)
 * from `from` to `to` (both `YYYY-MM-DD`, inclusive) and returns the raw JSON
 * from the exported zip. Same flow as download-and-upload.js on the
 * modified-endpoint branch.
 */
export const downloadSalesExport = async (
  credentials: EfactsoftCredentials,
  from: string,
  to: string
): Promise<Buffer> => {
  const loginUrl = credentials.loginUrl || DEFAULT_LOGIN_URL;
  const salesUrl = credentials.salesUrl || DEFAULT_SALES_URL;

  const browser = await chromium.launch({ headless: credentials.headless ?? true });
  const page = await browser.newPage();
  page.setDefaultTimeout(60_000);

  try {
    await page.goto(loginUrl);
    await page.fill('#usuario', credentials.user);
    await page.fill('#password', credentials.password);
    await page.click('button.auth-form-btn');
    await page
      .waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })
      .catch(() => {
        throw new Error('Efactsoft login failed: still on the login page. Check EFACTSOFT_USER / EFACTSOFT_PASSWORD.');
      });
    await page.waitForLoadState('networkidle');

    await page.goto(salesUrl);
    await page.waitForLoadState('networkidle');

    await page.click('a.btn-filtrar');
    await page.fill('#datefilter', buildDateRangeFilter(from, to));
    await page.keyboard.press('Enter');

    await page.click('button:has-text("Buscar")');
    await page.waitForLoadState('networkidle');

    await page.waitForFunction(() => {
      const button = document.querySelector('#export-json2') as HTMLElement | null;
      return Boolean(button?.dataset.url);
    });

    // A wide range takes Efactsoft a while to build the zip.
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 300_000 }),
      page.click('#export-json2'),
    ]);

    const stream = await download.createReadStream();
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) chunks.push(chunk as Uint8Array);

    const jsonEntry = new AdmZip(Buffer.concat(chunks))
      .getEntries()
      .find((entry) => entry.entryName.endsWith('.json'));
    if (!jsonEntry) throw new Error('No .json file found inside the Efactsoft export zip');

    return jsonEntry.getData();
  } catch (error) {
    const screenshot = await saveScreenshot(page);
    if (screenshot) (error as Error).message += ` (screenshot: ${screenshot})`;
    throw error;
  } finally {
    await browser.close();
  }
};
