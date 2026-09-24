import { Prisma } from '../../../generated/prisma/client';
import {
  KpiWindow,
  saleGapsCte,
} from '../fragments.sql';

/**
 * Clientes recuperados: customers who went more than inactivity_days without
 * buying and then bought again inside the period. The new purchase is the one
 * with the long gap behind it, and that is what marks the customer recovered.
 *
 * Two steps:
 *
 *   1. saleGapsCte (fragments.sql.ts) builds `gaps`: one row per sale, with
 *      the days since the SAME customer's previous sale (gap_days). A
 *      customer's first-ever sale has no previous one, so its gap is NULL and
 *      it never counts ("new customers" was retired from scope).
 *
 *   2. This query keeps the gaps of both periods and, per period, counts the
 *      DISTINCT customers with some sale whose gap exceeds the threshold. It
 *      counts customers, not sales: two qualifying sales of one customer in
 *      the same period still count once.
 *
 * Worked example, from=2026-09-01 to=2026-09-30 (previous: 2-31 Aug), 30 days:
 *
 *   gaps (from sale)                     kept by WHERE      counted
 *   A  10 Jun  NULL  first sale          no (NULL)
 *   A  20 Aug    71                      yes, previous  ->  A in previous_value
 *   A   5 Sep    16                      yes, current       no, 16 <= 30
 *   B  15 Jul    14                      no (before 2 Aug)
 *   B  10 Sep    57                      yes, current   ->  B in value
 *   C   3 Aug  NULL  first sale          no (NULL)
 *   D  25 Aug   116                      yes, previous  ->  D in previous_value
 *
 *   => value = 1 (B), previous_value = 2 (A, D)
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
