import { StagingResult } from '../domain/types/sales-import.types';
import { prisma } from '../lib/prisma';
import { stageSalesFile } from '../services/salesStaging.service';

/**
 * Import of an ERP sales file (RF-03).
 *
 * Orchestrates the full HU-02 flow. Today it has a single step; the second one
 * is added by PCRM-34.
 */

/**
 * Transaction headroom. Prisma defaults to 5 s, which is fine for a monthly
 * export (~350 sales) but not for a historical backfill (~18,000 sales per
 * year, CLAUDE.md 7.9) where `createMany` is split into dozens of batches.
 */
const TRANSACTION_TIMEOUT_MS = 120_000;
const TRANSACTION_MAX_WAIT_MS = 10_000;

export const importSalesFile = async (
  fileBuffer: Buffer,
  uploadedBy: string
): Promise<StagingResult> =>
  prisma.$transaction(
    async (tx) => {
      // STEP 1 — Intake: validate the file and queue it. PCRM-32 / PCRM-33.
      const result = await stageSalesFile(tx, fileBuffer, uploadedBy);

      // STEP 2 — Synchronize: drain the queue and upsert into `customer`,
      // `product`, `sale`, `sale_detail` and `balance_snapshot`.
      //
      // >>> PCRM-34 HOOKS IN HERE <<<
      // The synchronizer call goes here and must:
      //   - read `sale_staging` where upload_id = result.upload_id and status 'pending'
      //   - upsert idempotently on the ERP natural keys (CLAUDE.md 6.4),
      //     repeating the `WHERE deleted_at IS NULL` predicate in ON CONFLICT
      //     for the partial unique indexes (CLAUDE.md 9.2)
      //   - stamp `processed_at` on every processed row
      //   - update upload.inserted / upload.updated and leave upload.status
      //     as 'completed'
      //
      // It runs inside this same transaction by receiving `tx`, so a failure
      // halfway through the upsert cannot leave the batch half applied.
      //
      //   const sync = await syncStagedSales(tx, result.upload_id);
      //   return { ...result, ...sync };

      return result;
    },
    { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS }
  );
