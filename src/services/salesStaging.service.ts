import { CustomError } from '../domain/errors/CustomError';
import { efactsoftSaleSchema, formatZodIssues } from '../domain/schemas/efactsoft-sale.schema';
import {
  SaleRejection,
  SaleStagingStatus,
  StagingResult,
  UploadRange,
} from '../domain/types/sales-import.types';
import { parseErpDateOnly } from '../lib/parseErpDate';
import { Client } from '../lib/prisma';

/**
 * Intake of the ERP sales JSON: validates the file and queues it into
 * `upload` + `sale_staging` (RF-03, PCRM-32 and PCRM-33).
 *
 * This module does NOT write to the live tables (`customer`, `product`,
 * `sale`, `sale_detail`, `balance_snapshot`): that upsert is PCRM-34. The
 * separation is what makes acceptance criterion CA2 of HU-02 — "without
 * corrupting existing data" — hold by construction, because those tables are
 * never even opened during intake.
 */

/**
 * How many rejections travel back in the HTTP response. A file with thousands
 * of dirty records must not produce a multi-megabyte response; every rejection
 * is stored in `sale_staging` either way.
 */
export const MAX_REJECTIONS_IN_RESPONSE = 100;

/**
 * Batch size for `createMany`. Keeps a full historical backfill from building
 * one enormous INSERT (CLAUDE.md 7.9: ~18,000 sales per year). Postgres caps a
 * statement at 65,535 parameters and each row uses 5, so the hard ceiling is
 * around 13,000 rows.
 */
const STAGING_CHUNK_SIZE = 500;

interface StagingRow {
  erp_sale_id: number | null;
  payload: object;
  status: SaleStagingStatus;
  error: string | null;
}

/** Reads `venta.id_venta` from an entry without trusting its shape. */
const readErpSaleId = (item: unknown): number | null => {
  if (typeof item !== 'object' || item === null) return null;

  const venta = (item as { venta?: unknown }).venta;
  if (typeof venta !== 'object' || venta === null) return null;

  const id = (venta as { id_venta?: unknown }).id_venta;
  return typeof id === 'number' && Number.isInteger(id) ? id : null;
};

/** Turns the uploaded buffer into the array of sales, or fails explaining why. */
const parseFile = (fileBuffer: Buffer): unknown[] => {
  // The ERP export is UTF-8 (customer names carry accents); forcing it keeps
  // the server locale from reading it as ANSI.
  const text = fileBuffer.toString('utf-8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // JSON.parse detail ("Unexpected end of JSON input") is useless to an
    // administrator and leaks runtime internals. The fine-grained reason for
    // each rejected sale does travel, in `rejections`.
    throw CustomError.badRequest('The file is not valid JSON.');
  }

  if (!Array.isArray(parsed)) {
    throw CustomError.unprocessable('The file must contain an array of sales at the root.');
  }

  if (parsed.length === 0) {
    throw CustomError.unprocessable('The file does not contain any sales.');
  }

  return parsed;
};

/**
 * Validates each entry and builds the staging rows. Errors are per sale, not
 * per file: a dirty sale is flagged and the rest of the batch continues. The
 * history spans years of sales and one corrupt record cannot block the whole
 * load.
 */
const buildStagingRows = (items: unknown[]) => {
  const rows: StagingRow[] = [];
  const rejections: SaleRejection[] = [];
  const seenSaleIds = new Set<number>();

  let accepted = 0;
  let salesWithoutCustomer = 0;
  let salesWithoutUser = 0;
  let rangeFrom: Date | null = null;
  let rangeTo: Date | null = null;

  items.forEach((item, index) => {
    const erpSaleId = readErpSaleId(item);

    const reject = (reason: string) => {
      rejections.push({ index, erp_sale_id: erpSaleId, reason });
      rows.push({
        erp_sale_id: erpSaleId,
        // The RAW payload goes to staging, not the parsed one: PCRM-34 needs
        // all 200+ ERP fields, and a rejected sale has to be auditable exactly
        // as it arrived.
        payload: (item ?? {}) as object,
        status: 'failed',
        error: reason,
      });
    };

    const result = efactsoftSaleSchema.safeParse(item);
    if (!result.success) {
      reject(formatZodIssues(result.error));
      return;
    }

    const { venta } = result.data;

    // A repeated `id_venta` within the same file would break the PCRM-34
    // upsert against the `sale.erp_sale_id` natural key. It stops here.
    if (seenSaleIds.has(venta.id_venta)) {
      reject(`venta.id_venta: ${venta.id_venta} appears more than once in the file`);
      return;
    }
    seenSaleIds.add(venta.id_venta);

    if (venta.id_cliente === null || venta.id_cliente === undefined) salesWithoutCustomer += 1;
    if (venta.id_usuario === null || venta.id_usuario === undefined) salesWithoutUser += 1;

    const emitted = parseErpDateOnly(venta.fecha_emision);
    if (emitted) {
      if (!rangeFrom || emitted < rangeFrom) rangeFrom = emitted;
      if (!rangeTo || emitted > rangeTo) rangeTo = emitted;
    }

    accepted += 1;
    rows.push({
      erp_sale_id: venta.id_venta,
      payload: item as object,
      status: 'pending',
      error: null,
    });
  });

  const range: UploadRange = { from: rangeFrom, to: rangeTo };

  return { rows, rejections, accepted, range, salesWithoutCustomer, salesWithoutUser };
};

/**
 * Receives the file, validates it and leaves it queued for PCRM-34.
 *
 * Takes `Client` rather than `PrismaClient` so it can run standalone or inside
 * a `$transaction`, per the convention in CLAUDE.md 8.1.
 */
export const stageSalesFile = async (
  client: Client,
  fileBuffer: Buffer
): Promise<StagingResult> => {
  const items = parseFile(fileBuffer);

  const { rows, rejections, accepted, range, salesWithoutCustomer, salesWithoutUser } =
    buildStagingRows(items);

  // If not a single sale survived, the file is most likely not the sales
  // export. Bail out without creating the `upload` so the load history does
  // not fill up with empty batches.
  if (accepted === 0) {
    throw CustomError.unprocessable('No sale in the file has the expected format.');
  }

  const upload = await client.upload.create({
    data: {
      // The API has no authentication yet (CLAUDE.md 5.9 and 8.1): the column
      // is nullable and will be filled once the Clerk middleware exists.
      uploaded_by: null,
      range_from: range.from,
      range_to: range.to,
      sales_received: items.length,
      failed: rejections.length,
      // `inserted` and `updated` stay at 0: PCRM-34 fills them while processing.
      status: 'staged',
    },
  });

  for (let i = 0; i < rows.length; i += STAGING_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + STAGING_CHUNK_SIZE);
    await client.sale_staging.createMany({
      data: chunk.map((row) => ({
        upload_id: upload.id,
        erp_sale_id: row.erp_sale_id,
        payload: row.payload,
        status: row.status,
        error: row.error,
      })),
    });
  }

  return {
    upload_id: upload.id,
    sales_received: items.length,
    accepted,
    rejected: rejections.length,
    range,
    rejections: rejections.slice(0, MAX_REJECTIONS_IN_RESPONSE),
    rejections_truncated: Math.max(0, rejections.length - MAX_REJECTIONS_IN_RESPONSE),
    warnings: {
      sales_without_customer: salesWithoutCustomer,
      sales_without_user: salesWithoutUser,
    },
  };
};
