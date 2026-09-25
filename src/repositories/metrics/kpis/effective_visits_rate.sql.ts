import { Prisma } from '../../../generated/prisma/client';
import {
  KpiWindow,
  VISIT_AT,
  inWindow,
  inCurrent,
  inPrevious,
} from '../fragments.sql';

/**
 * Visitas efectivas (%): visits the seller flagged successful over all visits
 * of the period. Self-declared, so contrast it with sale.visit_id. Null
 * without visits.
 */
export const effectiveVisitsRateSql = (w: KpiWindow): Prisma.Sql => Prisma.sql`
  SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE ${inCurrent(VISIT_AT, w)} AND v.successful)
               / NULLIF(COUNT(*) FILTER (WHERE ${inCurrent(VISIT_AT, w)}), 0), 1)::float8
           AS value,
         ROUND(100.0 * COUNT(*) FILTER (WHERE ${inPrevious(VISIT_AT, w)} AND v.successful)
               / NULLIF(COUNT(*) FILTER (WHERE ${inPrevious(VISIT_AT, w)}), 0), 1)::float8
           AS previous_value
  FROM   visit v
  WHERE  v.deleted_at IS NULL
    AND  ${inWindow(VISIT_AT, w)}
`;
