import { readFileSync } from 'node:fs';

import { downloadYesterdaySales } from './lib/download-efactsoft-sales';
import {
  DEFAULT_CUTOFF,
  DEFAULT_USER,
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
  const user = process.env.DAILY_SALES_USER ?? DEFAULT_USER;
  const aggregates = summarizeYesterdaySales(sales, { cutoff, user });

  process.stdout.write(`${formatWhatsAppMessage(aggregates, cutoff)}\n`);
};

main().catch((error) => fail(`Unexpected error: ${(error as Error).message}`));
