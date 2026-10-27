import { Client } from '../lib/prisma';
import {
  softDeletePendingProspectStopsSql,
  softDeleteProspectSql,
} from './prospect/delete.sql';

/**
 * Soft-deletes the prospect and then its pending stops. Returns null when the
 * prospect did not exist or was already deleted (no row touched), so nothing
 * else is written. The caller runs both inside one transaction.
 */
export const softDeleteProspect = async (
  client: Client,
  prospectId: string,
  today: string
): Promise<{ removed_stops: number } | null> => {
  const deleted = await client.$executeRaw(softDeleteProspectSql(prospectId));
  if (deleted === 0) return null;

  const removed = await client.$executeRaw(softDeletePendingProspectStopsSql(prospectId, today));
  return { removed_stops: removed };
};
