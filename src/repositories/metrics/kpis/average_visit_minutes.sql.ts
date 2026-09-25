import { Prisma } from '../../../generated/prisma/client';
import {
  KpiWindow,
  VISIT_AT,
  inWindow,
  inCurrent,
  inPrevious,
} from '../fragments.sql';

/**
 * Tiempo promedio por visita (minutes). Visits without finished_at, or with it
 * before started_at, are left out instead of counted as zero.
 */
export const averageVisitMinutesSql = (w: KpiWindow): Prisma.Sql => Prisma.sql`
  SELECT ROUND((AVG(EXTRACT(EPOCH FROM (v.finished_at - v.started_at)) / 60.0)
                  FILTER (WHERE ${inCurrent(VISIT_AT, w)}
                            AND v.finished_at >= v.started_at))::numeric, 1)::float8
           AS value,
         ROUND((AVG(EXTRACT(EPOCH FROM (v.finished_at - v.started_at)) / 60.0)
                  FILTER (WHERE ${inPrevious(VISIT_AT, w)}
                            AND v.finished_at >= v.started_at))::numeric, 1)::float8
           AS previous_value
  FROM   visit v
  WHERE  v.deleted_at IS NULL
    AND  ${inWindow(VISIT_AT, w)}
`;
