import { Prisma } from '../../../generated/prisma/client';
import {
  KpiWindow,
  saleGapsCte,
} from '../fragments.sql';

/**
 * Frecuencia de compra (1v): average days between consecutive purchases of
 * the same customer, over the purchases of the period. History before the
 * period is read so its first purchase has a predecessor.
 */
export const purchaseFrequencyDaysSql = (w: KpiWindow): Prisma.Sql => Prisma.sql`
  WITH ${saleGapsCte(w.range)}
  SELECT ROUND(AVG(gap_days) FILTER (
           WHERE erp_created_at >= ${w.range.start}))::int AS value,
         ROUND(AVG(gap_days) FILTER (
           WHERE erp_created_at <  ${w.range.start}))::int AS previous_value
  FROM   gaps
  WHERE  gap_days IS NOT NULL
    AND  erp_created_at >= ${w.previous.start}
`;
