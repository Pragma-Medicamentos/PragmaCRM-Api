import { Prisma } from '../../generated/prisma/client';
import { ERP_STATUS_SALE } from '../../domain/constants/businessRules';
import { LocalDateRange } from '../../lib/localDateRange';
import { SALE_AT, TZ, inRange } from './fragments.sql';
import { attributedSalesCte } from './routeSales.sql';

/*
 * Per-route metrics (PCRM-178): the route cards of GET /metrics/routes and
 * the blocks of GET /metrics/routes/:id.
 *
 * A route is identified by `route.id`, the same uuid the routes API exposes
 * (presentation/routes/). Everything here reads the route's history, its
 * agenda (`scheduled_visit`), and reaches the route through the assignment
 * that generated each stop; sales follow the rule of ./routeSales.sql.ts.
 */

/** Columns of the route agenda inside the period, aliased `ag`. */
const agendaCte = (range: LocalDateRange): Prisma.Sql => Prisma.sql`
  agenda AS (
    -- visit_date is a plain date in the customer's calendar, so it compares
    -- against the range's local days with no timezone conversion. Stops on
    -- prospects have no customer and are not portfolio (CLAUDE.md 7.1).
    SELECT ru.route_id, sv.id, sv.customer_id
    FROM   scheduled_visit sv
    JOIN   route_user ru
           ON ru.id = sv.route_user_id
    WHERE  sv.deleted_at IS NULL
      AND  sv.customer_id IS NOT NULL
      AND  sv.visit_date >= ${range.from}::date
      AND  sv.visit_date <= ${range.to}::date
  )
`;

/**
 * One row per route, best attributed amount first, with the previous period's
 * amount for the variation. Includes routes with no activity, as zeros: the
 * panel lists the whole route catalogue, and an empty route is a finding.
 *
 * `routeId` keeps only that route; it is how the detail reads its summary.
 */
export const routeMetricsSql = (
  range: LocalDateRange,
  previous: LocalDateRange,
  routeId?: string
): Prisma.Sql => {
  const routeFilter = routeId ? Prisma.sql`AND r.id = ${routeId}::uuid` : Prisma.empty;

  return Prisma.sql`
    WITH
    ${attributedSalesCte({ start: previous.start, end: range.end })},
    route_sales AS (
      SELECT a.route_id,
             COALESCE(SUM(a.amount) FILTER (
               WHERE ${inRange(Prisma.raw('a.erp_created_at'), range)}), 0)     AS amount,
             COALESCE(SUM(a.amount) FILTER (
               WHERE ${inRange(Prisma.raw('a.erp_created_at'), previous)}), 0)  AS previous_amount
      FROM   attributed_sales a
      GROUP  BY a.route_id
    ),
    ${agendaCte(range)},
    coverage AS (
      -- Of the customers on the route's agenda, how many had a stop executed:
      -- a visit only exists for a stop of the agenda, so visited <= planned.
      SELECT ag.route_id,
             COUNT(DISTINCT ag.customer_id) AS planned_customers,
             COUNT(DISTINCT ag.customer_id) FILTER (
               WHERE EXISTS (SELECT 1 FROM visit v
                             WHERE v.scheduled_visit_id = ag.id
                               AND v.deleted_at IS NULL)
             )                              AS visited_customers
      FROM   agenda ag
      GROUP  BY ag.route_id
    ),
    operators AS (
      -- Who works the route: the sellers assigned today plus anyone who
      -- executed one of its stops in the period, so a reassignment mid-period
      -- does not erase whoever did the work.
      SELECT ru.route_id, u.id, u.name
      FROM   route_user ru
      JOIN   app_user u
             ON u.id = ru.user_id
            AND u.deleted_at IS NULL
      WHERE  ru.deleted_at IS NULL
      UNION
      SELECT ag.route_id, u.id, u.name
      FROM   agenda ag
      JOIN   visit v
             ON v.scheduled_visit_id = ag.id
            AND v.deleted_at IS NULL
      JOIN   app_user u
             ON u.id = v.user_id
            AND u.deleted_at IS NULL
    ),
    sellers AS (
      SELECT o.route_id,
             json_agg(json_build_object('user_id', o.id::text, 'name', o.name)
                      ORDER BY o.name) AS sellers
      FROM   operators o
      GROUP  BY o.route_id
    )
    SELECT r.id::text                                          AS route_id,
           r.name,
           r.municipality,
           r.zone,
           r.active,
           COALESCE(rs.amount, 0)::numeric(14,2)::text          AS amount,
           COALESCE(rs.previous_amount, 0)::numeric(14,2)::text AS previous_amount,
           ROUND(100.0 * COALESCE(c.visited_customers, 0)
                 / NULLIF(c.planned_customers, 0), 1)::float8   AS visit_coverage_rate,
           COALESCE(sl.sellers, '[]'::json)                     AS sellers
    FROM   route r
    LEFT   JOIN route_sales rs ON rs.route_id = r.id
    LEFT   JOIN coverage    c  ON c.route_id  = r.id
    LEFT   JOIN sellers     sl ON sl.route_id = r.id
    WHERE  r.deleted_at IS NULL
           ${routeFilter}
    ORDER  BY COALESCE(rs.amount, 0) DESC, r.name ASC
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
 * products out. Units are per product, where they add like with like.
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
         COUNT(DISTINCT a.erp_sale_id)::int AS orders_count
  FROM   attributed_sales a
  JOIN   app_user u
         ON u.id = a.user_id
  WHERE  a.route_id = ${routeId}::uuid
  GROUP  BY u.id, u.name
  ORDER  BY SUM(a.amount) DESC, u.name ASC
`;

/**
 * Portfolio coverage of the route: of the customers on its agenda in the
 * period, how many bought.
 *
 * Read from the agenda and not from today's `route_customer`, so a customer
 * moved to another route later still counts where it was planned. The
 * purchase counted is any confirmed sale of the customer, with or without a
 * visit behind it: the question is whether the portfolio is buying, not
 * whether the route gets the credit. Always one row, zeros included.
 */
export const routePortfolioCoverageSql = (
  range: LocalDateRange,
  routeId: string
): Prisma.Sql => Prisma.sql`
  WITH ${agendaCte(range)}
  SELECT COUNT(DISTINCT ag.customer_id)::int AS scheduled_customers,
         COUNT(DISTINCT ag.customer_id) FILTER (
           WHERE EXISTS (
             SELECT 1
             FROM   sale s
             WHERE  s.customer_id = ag.customer_id
               AND  s.deleted_at IS NULL
               AND  s.erp_status = ${ERP_STATUS_SALE}
               AND  ${inRange(SALE_AT, range)}
           )
         )::int AS purchasing_customers
  FROM   agenda ag
  WHERE  ag.route_id = ${routeId}::uuid
`;
