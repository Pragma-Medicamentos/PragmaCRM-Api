import { Prisma } from '../../../generated/prisma/client';
import {
  KpiWindow,
  VISIT_AT,
  inWindow,
  inCurrent,
  inPrevious,
} from '../fragments.sql';

/** Clientes visitados: distinct customers with at least one visit in the period. */
export const visitedCustomersSql = (w: KpiWindow): Prisma.Sql => Prisma.sql`
  SELECT COUNT(DISTINCT v.customer_id) FILTER (WHERE ${inCurrent(VISIT_AT, w)})::int  AS value,
         COUNT(DISTINCT v.customer_id) FILTER (WHERE ${inPrevious(VISIT_AT, w)})::int AS previous_value
  FROM   visit v
  WHERE  v.deleted_at IS NULL
    AND  ${inWindow(VISIT_AT, w)}
`;
