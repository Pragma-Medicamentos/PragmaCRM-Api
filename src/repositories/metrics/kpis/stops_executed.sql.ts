import { Prisma } from '../../../generated/prisma/client';
import {
  KpiWindow,
  VISIT_AT,
  inWindow,
  inCurrent,
  inPrevious,
} from '../fragments.sql';

/**
 * Paradas ejecutadas (1a, 1d): visits marked in the field, any stop type and
 * any seller. A planned stop that was never marked has no visit row and does
 * not count; that gap is route coverage, out of this panel.
 */
export const stopsExecutedSql = (w: KpiWindow): Prisma.Sql => Prisma.sql`
  SELECT COUNT(*) FILTER (WHERE ${inCurrent(VISIT_AT, w)})::int  AS value,
         COUNT(*) FILTER (WHERE ${inPrevious(VISIT_AT, w)})::int AS previous_value
  FROM   visit v
  WHERE  v.deleted_at IS NULL
    AND  ${inWindow(VISIT_AT, w)}
`;
