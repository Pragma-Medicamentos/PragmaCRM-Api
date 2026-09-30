import { CustomError } from '../domain/errors/CustomError';
import { StagingResult, SyncResult } from '../domain/types/sales-import.types';
import { Client, prisma } from '../lib/prisma';
import { logger } from '../lib/adapters/logger';
import { tryAcquireImportLock } from '../repositories/uploads.repository';
import { deleteAuthUser } from '../services/supabaseAdmin.service';
import {
  SellerProvisioning,
  SYNC_CHUNK_SIZE,
  finalizeUploadSync,
  markUploadProcessing,
  syncStagedSalesChunk,
} from '../services/salesSync.service';
import { stageSalesFile } from '../services/salesStaging.service';

/**
 * Import of an ERP sales file (RF-03).
 *
 * Orchestrates the full HU-02 flow: intake (PCRM-32/33) and synchronization
 * into the live tables (PCRM-34). Staging runs in one transaction; sync runs
 * in chunks of `SYNC_CHUNK_SIZE` pending rows per transaction so a month-sized
 * file (~350–400 sales) cannot hit Prisma's 120 s timeout (PCRM-168).
 */

export type ImportSalesResult = StagingResult & SyncResult;

/**
 * Transaction headroom per stage / sync-chunk TX. Prisma defaults to 5 s.
 * 120 s is enough for staging a large createMany batch and for one sync
 * chunk (~50 sales × ~14 awaits), but not for syncing a whole month in one go.
 */
const TRANSACTION_TIMEOUT_MS = 120_000;
const TRANSACTION_MAX_WAIT_MS = 10_000;

const txOptions = { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS };

/**
 * Headroom of the outer transaction that only holds the import advisory lock.
 * It must outlive a whole month-sized import (staging plus every sync chunk),
 * so it is far longer than the per-chunk budget above. The transaction sits
 * idle the whole time: that is the point, the lock lives as long as it does.
 */
const LOCK_TRANSACTION_TIMEOUT_MS = 900_000; // 15 minutes

const IMPORT_IN_PROGRESS_MESSAGE =
  'An import is already in progress. Wait until it finishes before uploading again.';

export const importSalesFile = async (
  fileBuffer: Buffer,
  uploadedBy: string
): Promise<ImportSalesResult> => {
  // Auth accounts created for new sellers live outside the transaction; if it
  // rolls back they must be deleted or a retry would find them orphaned.
  const provisioning: SellerProvisioning = { created: [], unmapped: [], createdAuthUserIds: [] };

  try {
    return await withImportLock(() => runImport(fileBuffer, uploadedBy, provisioning));
  } catch (error) {
    await Promise.all(
      provisioning.createdAuthUserIds.map((id) =>
        deleteAuthUser(id).catch((cleanupError) =>
          logger.error('Could not roll back an auth account after a failed import', {
            auth_user_id: id,
            cleanup_error: cleanupError,
          })
        )
      )
    );
    throw error;
  }
};

/**
 * Runs `work` while holding the cluster-wide import advisory lock, so only one
 * sales import writes at a time (PCRM-169). Concurrent imports deadlocked on
 * `product` (40P01 / P2034) because they upsert the same rows in different
 * orders, and closing the browser tab does not abort the first request.
 *
 * The lock is transaction-scoped: Postgres releases it when this outer
 * transaction ends, whether `work` returns or throws, and a crashed replica
 * releases it along with its connection. Nothing has to unlock explicitly.
 *
 * The outer transaction client is used for the lock only. `work` writes on the
 * root `prisma` client, in its own short transactions, so the heavy import is
 * not one giant transaction again (PCRM-168).
 */
const withImportLock = async <T>(work: () => Promise<T>): Promise<T> =>
  prisma.$transaction(
    async (lockTx: Client) => {
      // Non-blocking on purpose: a second import gets 409, it does not queue.
      const acquired = await tryAcquireImportLock(lockTx);
      if (!acquired) throw CustomError.conflict(IMPORT_IN_PROGRESS_MESSAGE);

      return work();
    },
    { timeout: LOCK_TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS }
  );

const runImport = async (
  fileBuffer: Buffer,
  uploadedBy: string,
  provisioning: SellerProvisioning
): Promise<ImportSalesResult> => {
  // STEP 1 — Intake: validate the file and queue it. PCRM-32 / PCRM-33.
  const result = await prisma.$transaction(
    async (tx: Client) => stageSalesFile(tx, fileBuffer, uploadedBy),
    txOptions
  );

  // Publish that the batch left intake before the long sync loop starts: it is
  // what GET /uploads/sales/in-progress reports to an admin who closed the tab.
  await prisma.$transaction(
    async (tx: Client) => markUploadProcessing(tx, result.upload_id),
    txOptions
  );

  // STEP 2 — Synchronize pending rows in chunks. Each chunk is its own
  // transaction so ~355 sales cannot exhaust a single 120 s TX (PCRM-168).
  //
  // If chunk N fails after chunks 1..N-1 already committed, earlier upserts
  // stay applied (idempotent on ERP natural keys); retrying the same file is
  // safe. Auth-user cleanup still runs on throw via the outer catch.
  let inserted = 0;
  let updated = 0;
  let sync_failed = 0;
  let hasMore = true;

  while (hasMore) {
    const chunk = await prisma.$transaction(
      async (tx: Client) =>
        syncStagedSalesChunk(tx, result.upload_id, provisioning, SYNC_CHUNK_SIZE),
      txOptions
    );
    inserted += chunk.inserted;
    updated += chunk.updated;
    sync_failed += chunk.sync_failed;
    hasMore = chunk.has_more;
  }

  // Finalize upload status once nothing is left pending.
  await prisma.$transaction(
    async (tx: Client) =>
      finalizeUploadSync(tx, result.upload_id, { inserted, updated, sync_failed }),
    txOptions
  );

  return {
    ...result,
    processed: inserted + updated,
    inserted,
    updated,
    sync_failed,
    sellers: {
      created_count: provisioning.created.length,
      created: provisioning.created,
      unmapped: provisioning.unmapped,
    },
  };
};
