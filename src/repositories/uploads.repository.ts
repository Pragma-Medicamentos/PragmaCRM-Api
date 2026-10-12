import { Client } from '../lib/prisma';
import { importLockHeldSql, tryImportLockSql } from './uploads/uploads.sql';

/*
 * Raw-SQL data access of the uploads module (RF-03, PCRM-169). The advisory
 * lock that serializes sales imports and the probe that tells the dashboard an
 * import is still running. The typed Prisma reads stay in the services.
 */

/**
 * Takes the import advisory lock on `client` without blocking. Returns false
 * when another import already holds it.
 *
 * `client` must be a transaction client: the lock is transaction-scoped and is
 * released when that transaction ends, however it ends.
 */
export const tryAcquireImportLock = async (client: Client): Promise<boolean> => {
  const rows = await client.$queryRaw<{ locked: boolean }[]>(tryImportLockSql());
  return rows[0]?.locked === true;
};

/** True while some backend of the cluster holds the import advisory lock. */
export const isImportLockHeld = async (client: Client): Promise<boolean> => {
  const rows = await client.$queryRaw<{ held: boolean }[]>(importLockHeldSql());
  return rows[0]?.held === true;
};
