import { Prisma } from '../../generated/prisma/client';
import { ERP_STATUS_SALE } from '../../domain/constants/businessRules';
import { LocalDateRange } from '../../lib/localDateRange';
import { SALE_AT, TZ, VISIT_AT, inRange } from './fragments.sql';
import { attributedSalesCte, routeDaysCte, routeSalesCte } from './routeSales.sql';

/*
 * Per-route metrics (PCRM-178): the ranking of GET /metrics/routes and the
 * blocks of GET /metrics/routes/:id.
 *
 * A route is identified by `route.id`, the same uuid the routes API exposes
 * (presentation/routes/). The sale carries no route: it reaches one through
 * `sale.visit_id -> visit.route_user_id -> route_user.route_id`, so every
 * query joins `route_user` to translate the assignment into the route id the
 * rest of the API speaks. The attribution itself lives in ./routeSales.sql.ts
 * and is never rewritten here.
 */

/**
 * One row per route, ranked by attributed amount. Includes routes with no
 * activity, as zeros: the panel lists the whole route catalogue, and an empty
 * route is a finding, not a missing row.
 *
 * `routeId` filters the result without changing the ranking: positions and
 * `total_amount` are computed over every route in the inner query and only
 * then filtered, so the detail of a route reports the position it really
 * holds instead of a 1 of 1.
 */
export const routeMetricsSql = (range: LocalDateRange, routeId?: string): Prisma.Sql => {
  const ranked = Prisma.sql`
    WITH
    ${routeSalesCte(range)},
    ${routeDaysCte(range)},
    executed AS (
      SELECT ru.route_id,
             COUNT(*)                            AS stops_executed,
             COUNT(DISTINCT v.customer_id)       AS visited_customers
      FROM   visit v
      JOIN   route_user ru
             ON ru.id = v.route_user_id
      WHERE  v.deleted_at IS NULL
        AND  v.route_user_id IS NOT NULL
        AND  ${inRange(VISIT_AT, range)}
      GROUP  BY ru.route_id
    ),
    planned AS (
      -- The agenda of the period. visit_date is a plain date already in the
      -- customer's calendar, so it compares against the range's local days
      -- and needs no timezone conversion. A stop on a prospect has a null
      -- customer_id and counts as a planned stop but not as a planned
      -- customer: a prospect is not portfolio (CLAUDE.md 7.1).
      SELECT ru.route_id,
             COUNT(*)                            AS stops_planned,
             COUNT(DISTINCT sv.customer_id)      AS planned_customers
      FROM   scheduled_visit sv
      JOIN   route_user ru
             ON ru.id = sv.route_user_id
      WHERE  sv.deleted_at IS NULL
        AND  sv.visit_date >= ${range.from}::date
        AND  sv.visit_date <= ${range.to}::date
      GROUP  BY ru.route_id
    ),
    operators AS (
      -- Who works the route: the sellers assigned today plus anyone who
      -- actually executed a stop on it during the period, so a reassignment
      -- mid-period does not erase whoever did the work.
      SELECT ru.route_id, u.id, u.name
      FROM   route_user ru
      JOIN   app_user u
             ON u.id = ru.user_id
            AND u.deleted_at IS NULL
      WHERE  ru.deleted_at IS NULL
      UNION
      SELECT ru.route_id, u.id, u.name
      FROM   visit v
      JOIN   route_user ru
             ON ru.id = v.route_user_id
      JOIN   app_user u
             ON u.id = v.user_id
            AND u.deleted_at IS NULL
      WHERE  v.deleted_at IS NULL
        AND  v.route_user_id IS NOT NULL
        AND  ${inRange(VISIT_AT, range)}
    ),
    sellers AS (
      SELECT o.route_id,
             json_agg(json_build_object('user_id', o.id::text, 'name', o.name)
                      ORDER BY o.name) AS sellers
      FROM   operators o
      GROUP  BY o.route_id
    )
    SELECT r.id::text        AS route_id,
           r.name,
           r.municipality,
           r.zone,
           r.active,
           COALESCE(rs.amount, 0)::numeric(14,2)::text AS amount,
           COALESCE(rs.units, 0)::numeric(16,4)::text  AS units,
           ROW_NUMBER() OVER (ORDER BY COALESCE(rs.amount, 0) DESC, r.name ASC)::int
             AS amount_position,
           ROW_NUMBER() OVER (ORDER BY COALESCE(rs.units, 0) DESC, r.name ASC)::int
             AS units_position,
           COALESCE(rd.days, 0)::int                   AS executed_route_days,
           -- Null, not zero: a route nobody executed has no effectiveness to
           -- report, and NULLIF keeps the division out of trouble.
           (rs.amount / NULLIF(rd.days, 0))::numeric(14,2)::text AS effectiveness,
           COALESCE(e.visited_customers, 0)::int       AS visited_customers,
           COALESCE(p.planned_customers, 0)::int       AS planned_customers,
           ROUND(100.0 * COALESCE(e.visited_customers, 0)
                 / NULLIF(p.planned_customers, 0), 1)::float8 AS visit_coverage_rate,
           COALESCE(e.stops_executed, 0)::int          AS stops_executed,
           COALESCE(p.stops_planned, 0)::int           AS stops_planned,
           COALESCE(sl.sellers, '[]'::json)            AS sellers,
           SUM(COALESCE(rs.amount, 0)) OVER ()::numeric(14,2)::text AS total_amount,
           SUM(COALESCE(rs.units, 0)) OVER ()::numeric(16,4)::text  AS total_units
    FROM   route r
    LEFT   JOIN route_sales rs ON rs.route_id = r.id
    LEFT   JOIN route_days  rd ON rd.route_id = r.id
    LEFT   JOIN executed    e  ON e.route_id  = r.id
    LEFT   JOIN planned     p  ON p.route_id  = r.id
    LEFT   JOIN sellers     sl ON sl.route_id = r.id
    WHERE  r.deleted_at IS NULL
  `;

  if (!routeId) {
    return Prisma.sql`${ranked} ORDER BY amount_position`;
  }

  return Prisma.sql`
    SELECT * FROM (${ranked}) ranked
    WHERE  ranked.route_id = ${routeId}
  `;
};

/**
 * Customers that bought the most on the route during the period, by
 * attributed amount. Sales with no customer are left out by the join; they
 * cannot be listed under a name, but they do stay inside the route's total.
 */
export const routeTopCustomersSql = (
  range: LocalDateRange,
  routeId: string,
  limit: number
): Prisma.Sql => Prisma.sql`
  WITH ${attributedSalesCte(range)}
  SELECT ROW_NUMBER() OVER (ORDER BY SUM(a.amount) DESC, c.name ASC)::int AS position,
         c.id::text                         AS customer_id,
         c.name,
         c.trade_name,
         SUM(a.amount)::numeric(14,2)::text AS amount,
         COUNT(DISTINCT a.erp_sale_id)::int AS orders_count
  FROM   attributed_sales a
  JOIN   customer c
         ON c.id = a.customer_id
  WHERE  a.route_id = ${routeId}::uuid
  GROUP  BY c.id, c.name, c.trade_name
  ORDER  BY SUM(a.amount) DESC, c.name ASC
  LIMIT  ${limit}
`;

/**
 * Products sold the most on the route during the period. Same rules as the
 * company-wide ranking (./products.sql.ts): VAT included, lines dated by
 * their sale, units in the product's base unit and orphan or deleted
 * products out.
 */
export const routeTopProductsSql = (
  range: LocalDateRange,
  routeId: string,
  limit: number
): Prisma.Sql => Prisma.sql`
  WITH ${attributedSalesCte(range)}
  SELECT ROW_NUMBER() OVER (ORDER BY SUM(d.total) DESC, p.erp_product_id ASC)::int AS position,
         p.erp_product_id::int              AS product_id,
         p.code,
         p.name,
         SUM(d.total)::numeric(14,2)::text  AS amount,
         SUM(d.quantity * COALESCE(d.factor, 1))::numeric(16,4)::text AS units
  FROM   attributed_sales a
  JOIN   sale_detail d
         ON d.erp_sale_id = a.erp_sale_id
        AND d.product_id IS NOT NULL
  JOIN   product p
         ON p.erp_product_id = d.product_id
        AND p.deleted_at IS NULL
  WHERE  a.route_id = ${routeId}::uuid
  GROUP  BY p.erp_product_id, p.code, p.name
  ORDER  BY SUM(d.total) DESC, p.erp_product_id ASC
  LIMIT  ${limit}
`;

/**
 * Attributed amount per local day of the week, Sunday first (Postgres `DOW`:
 * 0 Sunday … 6 Saturday). The seven buckets always come back, zeros included,
 * so the panel can show the week with no holes. The day is the sale's local
 * day (CLAUDE.md 5.7), not the UTC one.
 */
export const routeWeekdaySalesSql = (
  range: LocalDateRange,
  routeId: string
): Prisma.Sql => Prisma.sql`
  WITH
  ${attributedSalesCte(range)},
  weekdays AS (SELECT generate_series(0, 6) AS weekday)
  SELECT w.weekday::int                              AS weekday,
         COALESCE(SUM(a.amount), 0)::numeric(14,2)::text AS amount,
         COUNT(DISTINCT a.erp_sale_id)::int          AS orders_count
  FROM   weekdays w
  LEFT   JOIN attributed_sales a
         ON a.route_id = ${routeId}::uuid
        AND EXTRACT(DOW FROM a.erp_created_at AT TIME ZONE ${TZ}) = w.weekday
  GROUP  BY w.weekday
  ORDER  BY w.weekday
`;

/**
 * What each seller sold on this route in the period. The sale is credited to
 * `sale.user_id`, the ERP seller, the same criterion as the seller table of
 * 1d; only sellers with an attributed sale appear.
 */
export const routeSellerPerformanceSql = (
  range: LocalDateRange,
  routeId: string
): Prisma.Sql => Prisma.sql`
  WITH ${attributedSalesCte(range)}
  SELECT u.id::text                         AS user_id,
         u.name,
         SUM(a.amount)::numeric(14,2)::text AS amount,
         SUM(a.units)::numeric(16,4)::text  AS units,
         COUNT(DISTINCT a.erp_sale_id)::int AS orders_count
  FROM   attributed_sales a
  JOIN   app_user u
         ON u.id = a.user_id
  WHERE  a.route_id = ${routeId}::uuid
  GROUP  BY u.id, u.name
  ORDER  BY SUM(a.amount) DESC, u.name ASC
`;

/**
 * Portfolio coverage of the route: of the customers that make up the route
 * today (`route_customer`), how many bought in the period.
 *
 * Deliberately different from visit coverage. The purchase counted here is
 * any confirmed sale of the customer, with or without a visit behind it: the
 * question is whether the portfolio is buying, not whether the route gets
 * the credit. Always one row, zeros included.
 */
export const routePortfolioCoverageSql = (
  range: LocalDateRange,
  routeId: string
): Prisma.Sql => Prisma.sql`
  SELECT COUNT(*)::int AS assigned_customers,
         COUNT(*) FILTER (
           WHERE EXISTS (
             SELECT 1
             FROM   sale s
             WHERE  s.customer_id = rc.customer_id
               AND  s.deleted_at IS NULL
               AND  s.erp_status = ${ERP_STATUS_SALE}
               AND  ${inRange(SALE_AT, range)}
           )
         )::int AS purchasing_customers
  FROM   route_customer rc
  JOIN   customer c
         ON c.id = rc.customer_id
        AND c.deleted_at IS NULL
  WHERE  rc.route_id = ${routeId}::uuid
    AND  rc.deleted_at IS NULL
`;
