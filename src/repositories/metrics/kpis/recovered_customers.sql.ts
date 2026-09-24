import { Prisma } from '../../../generated/prisma/client';
import {
  KpiWindow,
  saleGapsCte,
} from '../fragments.sql';

/**
 * Clientes recuperados: customers with a purchase in the period that came
 * after more than inactivity_days without buying. A first-ever purchase has
 * no gap and does not count ("new customers" was retired from scope).
 */
export const recoveredCustomersSql = (w: KpiWindow): Prisma.Sql => Prisma.sql`
  WITH ${saleGapsCte(w.range)}
  SELECT COUNT(DISTINCT customer_id) FILTER (
           WHERE erp_created_at >= ${w.range.start}
             AND gap_days > ${w.inactivityDays})::int AS value,
         COUNT(DISTINCT customer_id) FILTER (
           WHERE erp_created_at <  ${w.range.start}
             AND gap_days > ${w.inactivityDays})::int AS previous_value
  FROM   gaps
  WHERE  gap_days IS NOT NULL
    AND  erp_created_at >= ${w.previous.start}
`;
