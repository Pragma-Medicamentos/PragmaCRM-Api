import { Prisma } from '../../../generated/prisma/client';
import {
  KpiWindow,
  PROSPECT_AT,
  inCurrent,
  inPrevious,
  inWindow,
} from '../fragments.sql';

/** Prospectos nuevos (1a): prospects registered in the period, whatever their status now. */
export const newProspectsSql = (w: KpiWindow): Prisma.Sql => Prisma.sql`
  SELECT COUNT(*) FILTER (WHERE ${inCurrent(PROSPECT_AT, w)})::int  AS value,
         COUNT(*) FILTER (WHERE ${inPrevious(PROSPECT_AT, w)})::int AS previous_value
  FROM   prospect p
  WHERE  p.deleted_at IS NULL
    AND  ${inWindow(PROSPECT_AT, w)}
`;
