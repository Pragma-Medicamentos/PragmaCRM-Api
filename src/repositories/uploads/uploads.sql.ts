import { Prisma } from '../../generated/prisma/client';

/*
 * SQL of the uploads module (RF-03). Only what Prisma's typed API cannot
 * express: the advisory-lock calls, the `pg_locks` probe behind the
 * in-progress endpoint (PCRM-169) and the pending-balance summary behind the
 * daily sync range.
 */

/**
 * Oldest export date (`created_at` of the quotation) among live sales that
 * still owe money, plus how many of them start before `cutoff`.
 *
 * `erp_quoted_at` is the date Efactsoft filters its export on (CLAUDE.md 5.5);
 * sales loaded before that column existed fall back to `erp_created_at`,
 * which is never earlier, so the fallback can only narrow the range by the
 * quotation's lead time.
 */
export const pendingBalanceSummarySql = (cutoff: Date): Prisma.Sql =>
  Prisma.sql`
    SELECT
      min(COALESCE(erp_quoted_at, erp_created_at)) AS oldest_quoted_at,
      count(*)::int AS pending_sales,
      count(*) FILTER (
        WHERE COALESCE(erp_quoted_at, erp_created_at) < ${cutoff}
      )::int AS pending_before_cutoff
    FROM sale
    WHERE deleted_at IS NULL
      AND erp_status = 2
      AND pending_balance > 0
  `;

/**
 * Key of the import-wide advisory lock: classid 169 (the ticket), objid 1.
 * Two ints, so it never collides with the single-bigint locks taken by
 * `visit.service` and `route.service`.
 */
export const IMPORT_LOCK_CLASS_ID = 169;
export const IMPORT_LOCK_OBJECT_ID = 1;

/**
 * Non-blocking attempt at the import lock. Returns one row with `locked`.
 * The blocking variant is deliberately not used: a second import must be
 * rejected with 409, not queued behind the first one.
 */
export const tryImportLockSql = (): Prisma.Sql =>
  Prisma.sql`
    SELECT pg_try_advisory_xact_lock(${IMPORT_LOCK_CLASS_ID}::int, ${IMPORT_LOCK_OBJECT_ID}::int) AS locked
  `;

/**
 * True while any backend holds the import lock, including one on another
 * replica: `pg_locks` is cluster-wide. `granted` filters out backends that are
 * only waiting for it.
 */
export const importLockHeldSql = (): Prisma.Sql =>
  Prisma.sql`
    SELECT EXISTS (
      SELECT 1
      FROM pg_locks
      WHERE locktype = 'advisory'
        AND classid = ${IMPORT_LOCK_CLASS_ID}::int
        AND objid = ${IMPORT_LOCK_OBJECT_ID}::int
        AND granted
    ) AS held
  `;
