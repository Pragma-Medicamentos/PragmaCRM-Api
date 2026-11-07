import { DateTime } from 'luxon';
import { envs } from '../config/envs';
import { ERP_TIMEZONE } from '../lib/parseErpDate';
import { Client } from '../lib/prisma';
import { findPendingBalanceSummary, isImportLockHeld } from '../repositories/uploads.repository';

/*
 * Read side of the sales import (RF-03, PCRM-169). Tells the dashboard whether
 * an import is still running, which matters because closing the browser tab
 * does not abort the POST that started it, and tells the daily Efactsoft sync
 * which range to export.
 */

export interface SalesSyncRange {
  /** First local day to export, `YYYY-MM-DD` in BUSINESS_TIMEZONE. */
  from: string;
  /** Last local day to export (today), `YYYY-MM-DD` in BUSINESS_TIMEZONE. */
  to: string;
  /** Local day of the oldest sale that still owes money, or null if none does. */
  oldest_pending_date: string | null;
  pending_sales: number;
  /** Pending sales older than `from`: their balance will not refresh. */
  pending_outside_range: number;
  min_lookback_days: number;
  max_lookback_days: number;
}

export interface SalesSyncRangeOptions {
  now?: DateTime;
  minLookbackDays?: number;
  maxLookbackDays?: number;
}

/**
 * Range of quotation dates (`venta.created_at`, the field Efactsoft filters
 * its export on) the daily sync must re-export so every sale that still owes
 * money comes back with its current `saldop`. An export of only the last day
 * would leave `sale.pending_balance` frozen at whatever it was on the day the
 * sale was first imported.
 *
 * Starts at the oldest sale with `pending_balance > 0`, but never later than
 * `minLookbackDays` ago (quotations converted days later, missed runs) nor
 * earlier than `maxLookbackDays` ago. Ends today. Every day of the range is
 * reconciled by the import (CLAUDE.md 5.5), which is correct because the
 * export carries everything Efactsoft has for those days.
 */
export const getSalesSyncRange = async (
  client: Client,
  options: SalesSyncRangeOptions = {}
): Promise<SalesSyncRange> => {
  const minLookbackDays = options.minLookbackDays ?? envs.SALES_SYNC_MIN_LOOKBACK_DAYS;
  const maxLookbackDays = Math.max(
    options.maxLookbackDays ?? envs.SALES_SYNC_MAX_LOOKBACK_DAYS,
    minLookbackDays
  );

  const today = (options.now ?? DateTime.now()).setZone(ERP_TIMEZONE).startOf('day');
  const latestStart = today.minus({ days: minLookbackDays });
  const earliestStart = today.minus({ days: maxLookbackDays });

  const summary = await findPendingBalanceSummary(client, earliestStart.toJSDate());

  const oldestPending = summary.oldest_quoted_at
    ? DateTime.fromJSDate(summary.oldest_quoted_at).setZone(ERP_TIMEZONE).startOf('day')
    : null;

  let from = latestStart;
  if (oldestPending && oldestPending < from) {
    from = oldestPending < earliestStart ? earliestStart : oldestPending;
  }

  return {
    from: from.toISODate()!,
    to: today.toISODate()!,
    oldest_pending_date: oldestPending?.toISODate() ?? null,
    pending_sales: summary.pending_sales,
    pending_outside_range: summary.pending_before_cutoff,
    min_lookback_days: minLookbackDays,
    max_lookback_days: maxLookbackDays,
  };
};

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
