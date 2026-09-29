import { Prisma } from '../../../generated/prisma/client';
import {
  KpiWindow,
  VISIT_AT,
  inWindow,
  inCurrent,
  inPrevious,
} from '../fragments.sql';

/**
 * Paradas por tipo (1f): the same count split by the mandatory stop type
 * (CLAUDE.md 5.2). A visit with a null visit_type counts in stops_executed
 * but in none of these three.
 */
export const stopsByTypeSql = (w: KpiWindow): Prisma.Sql => Prisma.sql`
  SELECT COUNT(*) FILTER (WHERE ${inCurrent(VISIT_AT, w)}  AND v.visit_type = 'visit')::int      AS visit,
         COUNT(*) FILTER (WHERE ${inCurrent(VISIT_AT, w)}  AND v.visit_type = 'dispatch')::int   AS dispatch,
         COUNT(*) FILTER (WHERE ${inCurrent(VISIT_AT, w)}  AND v.visit_type = 'collection')::int AS collection,
         COUNT(*) FILTER (WHERE ${inPrevious(VISIT_AT, w)} AND v.visit_type = 'visit')::int      AS previous_visit,
         COUNT(*) FILTER (WHERE ${inPrevious(VISIT_AT, w)} AND v.visit_type = 'dispatch')::int   AS previous_dispatch,
         COUNT(*) FILTER (WHERE ${inPrevious(VISIT_AT, w)} AND v.visit_type = 'collection')::int AS previous_collection
  FROM   visit v
  WHERE  v.deleted_at IS NULL
    AND  ${inWindow(VISIT_AT, w)}
`;
