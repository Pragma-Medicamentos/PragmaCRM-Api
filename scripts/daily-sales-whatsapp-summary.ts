import { readFileSync } from 'node:fs';

import { DateTime } from 'luxon';

import { ERP_TIMEZONE } from '../src/lib/parseErpDate';
import { downloadYesterdaySales } from './lib/download-efactsoft-sales';
import { sendDailySalesEmail } from './lib/send-daily-sales-email';
import {
  DEFAULT_CUTOFF,
  ErpSale,
  formatWhatsAppMessage,
  summarizeYesterdaySales,
} from './lib/summarize-yesterday-sales';

const resolveFilePath = (argv: string[]): string | undefined => {
  const fileFlagIndex = argv.indexOf('--file');
  if (fileFlagIndex !== -1 && argv[fileFlagIndex + 1]) return argv[fileFlagIndex + 1];

  const positional = argv.find((arg) => !arg.startsWith('--'));
  if (positional) return positional;

  return process.env.SALES_JSON_PATH;
};

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const readSalesFromFile = (filePath: string): ErpSale[] => {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (error) {
    return fail(`Could not read file "${filePath}": ${(error as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return fail(`Invalid JSON in "${filePath}": ${(error as Error).message}`);
  }

  if (!Array.isArray(parsed)) {
    return fail(`Expected a JSON array of sales in "${filePath}", got ${typeof parsed}.`);
  }

  return parsed as ErpSale[];
};

const main = async (): Promise<void> => {
  const filePath = resolveFilePath(process.argv.slice(2));

  let sales: ErpSale[];
  if (filePath) {
    sales = readSalesFromFile(filePath);
  } else {
    try {
      sales = await downloadYesterdaySales();
    } catch (error) {
      return fail(`Could not download sales from Efactsoft: ${(error as Error).message}`);
    }
  }

  const cutoff = process.env.DAILY_CUTOFF ?? DEFAULT_CUTOFF;
  const aggregates = summarizeYesterdaySales(sales, { cutoff });
  const message = formatWhatsAppMessage(aggregates, cutoff);

  process.stdout.write(`${message}\n`);

  if (process.env.SKIP_EMAIL === 'true') return;

  const yesterday = DateTime.now().setZone(ERP_TIMEZONE).minus({ days: 1 }).toFormat('dd/MM/yyyy');
  try {
    await sendDailySalesEmail(message, { subject: `Ventas de ayer (${yesterday})` });
  } catch (error) {
    return fail(`Could not send the daily sales email: ${(error as Error).message}`);
  }
};

main().catch((error) => fail(`Unexpected error: ${(error as Error).message}`));
