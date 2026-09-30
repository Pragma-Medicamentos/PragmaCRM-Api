import { Client } from '../lib/prisma';
import { isImportLockHeld } from '../repositories/uploads.repository';

/*
 * Read side of the sales import (RF-03, PCRM-169). Tells the dashboard whether
 * an import is still running, which matters because closing the browser tab
 * does not abort the POST that started it.
 */

/** Statuses an upload sits in while its import has not finished yet. */
const ACTIVE_UPLOAD_STATUSES = ['staged', 'processing'];

/**
 * How far back an active-looking upload row still counts as running. It bounds
 * rows left behind by a replica that died mid-import, which no longer hold the
 * advisory lock but never reached a terminal status either.
 */
const ACTIVE_UPLOAD_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

export interface ImportInProgressStatus {
  in_progress: boolean;
  upload_id: string | null;
  status: string | null;
  updated_at: string | null;
}

/**
 * An import counts as in progress when the advisory lock is held by any
 * backend of the cluster, or when a recent upload row is still non-terminal.
 * The lock alone answers the common case; the row also names the batch, which
 * the lock cannot, and covers a stale one whose holder is gone.
 */
export const getImportInProgress = async (client: Client): Promise<ImportInProgressStatus> => {
  const [lockHeld, upload] = await Promise.all([
    isImportLockHeld(client),
    client.upload.findFirst({
      where: {
        status: { in: ACTIVE_UPLOAD_STATUSES },
        updated_at: { gte: new Date(Date.now() - ACTIVE_UPLOAD_WINDOW_MS) },
      },
      orderBy: { updated_at: 'desc' },
      select: { id: true, status: true, updated_at: true },
    }),
  ]);

  return {
    in_progress: lockHeld || upload !== null,
    // Null when only the lock is held: the request has not created the upload
    // row yet, which is the whole staging step.
    upload_id: upload?.id ?? null,
    status: upload?.status ?? null,
    updated_at: upload?.updated_at.toISOString() ?? null,
  };
};
