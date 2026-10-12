import { Prisma } from '../../generated/prisma/client';

/*
 * SQL of the uploads module (RF-03). Only what Prisma's typed API cannot
 * express: the advisory-lock calls and the `pg_locks` probe behind the
 * in-progress endpoint (PCRM-169).
 */

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
