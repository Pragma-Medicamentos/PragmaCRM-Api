import { Prisma } from '../../generated/prisma/client';
import { ERP_STATUS_SALE } from '../../domain/constants/businessRules';
import { LocalDateRange, goalMonths } from '../../lib/localDateRange';
import { SALE_AT } from './fragments.sql';

/**
 * One row per calendar month of the range, oldest first, for a seller's goal
 * history chart (PCRM-198): the goal in force that month, under the same rule
 * as goalSlicesCte (latest live row at or before the month; 0 is no goal), and
 * the seller's confirmed sales inside it. Months without goal or sales are
 * still returned, so the chart has no holes. The range is expected to cover
 * whole months: the goal is not prorated here.
 */
export const goalHistorySql = (range: LocalDateRange, sellerId: string): Prisma.Sql => {
  const months = goalMonths(range).map(
    (m) => Prisma.sql`(${m.year}::int, ${m.month}::int, ${m.start}::timestamptz, ${m.end}::timestamptz)`
  );

  return Prisma.sql`
    SELECT gm.year,
           gm.month,
           NULLIF(eg.goal_amount, 0)::numeric(14,2)::text AS goal_amount,
           sales.total::numeric(14,2)::text              AS total_sales,
           ROUND(100.0 * sales.total / NULLIF(eg.goal_amount, 0), 1)::float8 AS goal_compliance
    FROM   (VALUES ${Prisma.join(months)}) AS gm (year, month, starts_at, ends_at)
    LEFT   JOIN LATERAL (
             SELECT g.goal_amount
             FROM   goal g
             WHERE  g.user_id = ${sellerId}::uuid
               AND  g.deleted_at IS NULL
               AND  (g.year * 100 + g.month) <= gm.year * 100 + gm.month
             ORDER  BY g.year DESC, g.month DESC
             LIMIT  1
           ) eg ON true
    CROSS  JOIN LATERAL (
             SELECT COALESCE(SUM(s.total), 0) AS total
             FROM   sale s
             WHERE  s.deleted_at IS NULL
               AND  s.erp_status = ${ERP_STATUS_SALE}
               AND  s.user_id = ${sellerId}::uuid
               AND  ${SALE_AT} >= gm.starts_at
               AND  ${SALE_AT} <  gm.ends_at
           ) sales
    ORDER  BY gm.year, gm.month
  `;
};
