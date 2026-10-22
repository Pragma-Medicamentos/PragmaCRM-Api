import { Prisma } from '../../generated/prisma/client';
import { ERP_STATUS_SALE } from '../../domain/constants/businessRules';
import { ROLES } from '../../domain/types/auth.types';
import { LocalDateRange } from '../../lib/localDateRange';
import { SALE_AT, goalSlicesCte, inRange } from '../metrics/fragments.sql';

/*
 * Cumplimiento de metas por vendedor (PCRM-159). Reuses goalSlicesCte, the
 * definition behind the goal_compliance KPI (PCRM-173): monthly goals
 * prorated to the share of each month inside the range, against the seller's
 * confirmed sales inside those same month slices. With no filter, total sales
 * over total goal is exactly the KPI.
 *
 * Goals belong to sellers, not to routes or zones, so only the seller filter
 * applies here.
 */
export const goalsBySellerSql = (range: LocalDateRange, userId?: string): Prisma.Sql => {
  const sellerFilter = userId ? Prisma.sql`AND u.id = ${userId}::uuid` : Prisma.empty;

  return Prisma.sql`
    WITH ${goalSlicesCte(range, 'slices')},
    goals AS (
      SELECT gs.user_id,
             SUM(gs.goal_amount) AS goal_amount,
             SUM(gs.sales)       AS goal_sales
      FROM   slices gs
      GROUP  BY gs.user_id
    ),
    sales AS (
      SELECT s.user_id,
             SUM(s.total) AS amount
      FROM   sale s
      WHERE  s.deleted_at IS NULL
        AND  s.erp_status = ${ERP_STATUS_SALE}
        AND  ${inRange(SALE_AT, range)}
      GROUP  BY s.user_id
    )
    SELECT u.name                                               AS seller_name,
           u.active,
           g.goal_amount::numeric(14,2)::text                   AS goal_amount,
           g.goal_sales::numeric(14,2)::text                    AS goal_sales,
           ROUND(100.0 * g.goal_sales / NULLIF(g.goal_amount, 0), 1)::float8 AS compliance,
           COALESCE(sa.amount, 0)::numeric(14,2)::text          AS total_sales
    FROM   app_user u
    LEFT   JOIN goals g
           ON g.user_id = u.id
    LEFT   JOIN sales sa
           ON sa.user_id = u.id
    WHERE  u.role = ${ROLES.SELLER}
      AND  u.deleted_at IS NULL
      AND  (u.active OR g.user_id IS NOT NULL OR sa.user_id IS NOT NULL)
      ${sellerFilter}
    ORDER  BY 5 DESC NULLS LAST, u.name
  `;
};
