import { Prisma } from '../../generated/prisma/client';

/**
 * Soft-deletes the prospect. Guarded by `deleted_at IS NULL` so a second
 * delete (or a concurrent one) touches no row and the service answers 404.
 */
export const softDeleteProspectSql = (prospectId: string): Prisma.Sql => Prisma.sql`
  UPDATE prospect
  SET    deleted_at = now(),
         updated_at = now()
  WHERE  id = ${prospectId}::uuid
    AND  deleted_at IS NULL
`;

/**
 * Soft-deletes the prospect's pending stops: from today on (business date)
 * and not executed yet. Past and executed stops stay as the prospect's
 * history, same cut as moveProspectStopsSql uses on conversion (PCRM-186).
 */
export const softDeletePendingProspectStopsSql = (
  prospectId: string,
  today: string
): Prisma.Sql => Prisma.sql`
  UPDATE scheduled_visit sv
  SET    deleted_at = now(),
         updated_at = now()
  WHERE  sv.prospect_id = ${prospectId}::uuid
    AND  sv.deleted_at IS NULL
    AND  sv.visit_date >= ${today}::date
    AND  NOT EXISTS (
           SELECT 1 FROM visit v
           WHERE  v.scheduled_visit_id = sv.id
             AND  v.deleted_at IS NULL
         )
`;
