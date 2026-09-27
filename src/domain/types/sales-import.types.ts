/**
 * Shared types for the ERP sales import flow (RF-03, PCRM-32 / PCRM-33).
 */

/** A sale that failed validation and was flagged in `sale_staging`. */
export interface SaleRejection {
  /** Position within the file array, so the administrator can locate it. */
  index: number;
  /** The payload's `id_venta`, when it was readable. */
  erp_sale_id: number | null;
  /** Reason in the same shape as the rest of the API: `field: message`. */
  reason: string;
}

/**
 * Values of `upload.status` across the import lifecycle. The column is free
 * text in the database (no check constraint), so this type is the only
 * contract.
 *
 *   staged      -> file received and queue ready        (PCRM-32/33, this module)
 *   processing  -> the synchronizer is draining it      (PCRM-34)
 *   completed   -> upsert finished                      (PCRM-34)
 *   failed      -> processing aborted                   (PCRM-34)
 */
export type UploadStatus = 'staged' | 'processing' | 'completed' | 'failed';

/**
 * Values of `sale_staging.status`. `sale_staging` is a work queue, so these
 * describe PROCESSING, not validation:
 *
 *   pending    -> validated and queued, waiting for PCRM-34   (this module)
 *   failed     -> failed validation, will not be processed    (this module)
 *   processed  -> already upserted into the live tables       (PCRM-34)
 *
 * Careful with `pending`: it does NOT mean "pending validation" — that sale
 * already passed the schema. The PCRM-34 synchronizer queries
 * `WHERE upload_id = ? AND status = 'pending'` to know what is left, and
 * without the distinction it would reprocess records we already know are
 * broken. It is also what makes retrying a batch possible without re-uploading
 * the file.
 *
 * The name comes from the column's `@default("pending")` (prisma/schema.prisma),
 * defined in PCRM-31.
 */
export type SaleStagingStatus = 'pending' | 'failed' | 'processed';

/** Invoice date range covered by the batch, for `upload.range_from/to`. */
export interface UploadRange {
  from: Date | null;
  to: Date | null;
}

/** Result of receiving and queueing a file. */
export interface StagingResult {
  upload_id: string;
  /** How many entries the file carried, including quotations. */
  sales_received: number;
  /** Sales queued as `pending`, ready for PCRM-34. Excludes quotations. */
  accepted: number;
  /** Sales queued as `failed`. */
  rejected: number;
  range: UploadRange;
  /**
   * Rejection details, truncated so a very dirty file does not produce a huge
   * response. `rejected` keeps the real total and every rejection is stored in
   * `sale_staging` regardless.
   */
  rejections: SaleRejection[];
  /** How many rejections were left out of `rejections` by the truncation. */
  rejections_truncated: number;
  /**
   * Control figures, not errors: accepted sales that are missing a link. They
   * explain why one report will not match another
   * (CLAUDE.md Appendix A #2).
   */
  warnings: {
    /** Counter sales with no `id_cliente`. */
    sales_without_customer: number;
    /** Sales with no `id_usuario`: not attributable to any route. */
    sales_without_user: number;
    /**
     * Quotations (`venta.estado === 1`): valid entries that are neither
     * staged nor synchronized because a quotation may never become a sale
     * (CLAUDE.md 5.5). Confirmed by the team on 2026-09-11.
     */
    quotations_skipped: number;
  };
}

/** A seller created from the payload because its `erp_user_id` was unknown. */
export interface SellerCreated {
  erp_user_id: number;
  name: string;
}

/** A seller in the payload that could not be created; its sales load unlinked. */
export interface SellerUnmapped extends SellerCreated {
  reason: string;
}

/** Result of draining `sale_staging` into the live tables (PCRM-34). */
export interface SyncResult {
  /** Sales upserted into `sale`, inserted or updated. */
  processed: number;
  /** Sales that did not exist in `sale` yet. */
  inserted: number;
  /** Sales that already existed in `sale` and were refreshed. */
  updated: number;
  /**
   * Staged rows that failed re-validation during sync and were left as
   * `failed` instead of `processed`. Distinct from `StagingResult.rejected`,
   * which counts intake-time rejections.
   */
  sync_failed: number;
  /**
   * Sellers auto-created by this import (disabled, awaiting an admin) and
   * those that could not be mapped.
   */
  sellers: {
    created_count: number;
    created: SellerCreated[];
    unmapped: SellerUnmapped[];
  };
}
