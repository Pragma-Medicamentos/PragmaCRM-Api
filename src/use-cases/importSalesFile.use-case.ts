import { StagingResult, SyncResult } from '../domain/types/sales-import.types';
import { prisma } from '../lib/prisma';
import { syncStagedSales } from '../services/salesSync.service';
import { stageSalesFile } from '../services/salesStaging.service';

/**
 * Import of an ERP sales file (RF-03).
 *
 * Orchestrates the full HU-02 flow: intake (PCRM-32/33) and synchronization
 * into the live tables (PCRM-34), inside one transaction.
 */

export type ImportSalesResult = StagingResult & SyncResult;

/**
 * Transaction headroom. Prisma defaults to 5 s, which is fine for a monthly
 * export (~350 sales) but not for a historical backfill (~18,000 sales per
 * year, CLAUDE.md 7.9) where `createMany` is split into dozens of batches.
 */
const TRANSACTION_TIMEOUT_MS = 120_000;
const TRANSACTION_MAX_WAIT_MS = 10_000;

export const importSalesFile = async (fileBuffer: Buffer): Promise<ImportSalesResult> =>
  prisma.$transaction(
    async (tx) => {
      // STEP 1 — Intake: validate the file and queue it. PCRM-32 / PCRM-33.
      const result = await stageSalesFile(tx, fileBuffer);

      // STEP 2 — Synchronize: drain the queue and upsert into `customer`,
      // `product`, `sale`, `sale_detail` and `balance_snapshot`. PCRM-34.
      //
      // Runs inside this same transaction by receiving `tx`, so a failure
      // halfway through the upsert cannot leave the batch half applied.
      const sync = await syncStagedSales(tx, result.upload_id);

      return { ...result, ...sync };
    },
    { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS }
  );
