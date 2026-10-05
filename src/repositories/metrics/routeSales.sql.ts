import { Prisma } from '../../generated/prisma/client';
import { ERP_STATUS_SALE } from '../../domain/constants/businessRules';
import { DateSpan, SALE_AT, TZ, VISIT_AT, inRange } from './fragments.sql';

/*
 * Route sale attribution: the single definition of "sale of a route"
 * (CLAUDE.md 5.4, PCRM-178).
 *
 * It is the same rule the company-wide KPI `route_effectiveness` applies
 * (./kpis/route_effectiveness.sql.ts): a confirmed sale joined to a visit
 * that carries a `route_user_id`. A sale without `visit_id`, or linked to a
 * visit made off route, is not route sale and never reaches these CTEs, so
 * the per-route figures add up to the company-wide numerator and stay below
 * `total_sales` (Anexo A.2).
 *
 * Every per-route query of the module builds on these two CTEs instead of
 * repeating the joins, so the rule can only change in one place. PCRM-176
 * (average ticket per route) imports `routeSalesTotalsSql` for the same
 * reason: amount and invoice count come from here, the division is its own.
 *
 * `route_user.deleted_at` is deliberately not filtered: an assignment that
 * was later reassigned still executed the visits of its period, and the
 * company-wide KPI counts them too. The join only resolves which route the
 * visit belonged to.
 */

/**
 * One row per sale attributed to a route, with the route it belongs to and
 * the sale's units in the product's base unit.
 *
 * `units` normalises each line with `quantity * factor`, the same rule as the
 * product ranking (./products.sql.ts): the same product sells by UNIDAD and
 * by DOCENA, so raw quantities do not add like with like. The lateral
 * subquery keeps one row per sale, which `SUM(amount)` depends on: joining
 * `sale_detail` directly would multiply the sale's total by its line count.
 */
export const attributedSalesCte = (range: DateSpan): Prisma.Sql => Prisma.sql`
  attributed_sales AS (
    SELECT ru.route_id,
           s.erp_sale_id,
           s.customer_id,
           s.user_id,
           s.erp_created_at,
           s.total                 AS amount,
           COALESCE(u.units, 0)    AS units
    FROM   sale s
    JOIN   visit v
           ON v.id = s.visit_id
          AND v.deleted_at IS NULL
          AND v.route_user_id IS NOT NULL
    JOIN   route_user ru
           ON ru.id = v.route_user_id
    LEFT   JOIN LATERAL (
             SELECT SUM(d.quantity * COALESCE(d.factor, 1)) AS units
             FROM   sale_detail d
             WHERE  d.erp_sale_id = s.erp_sale_id
           ) u ON true
    WHERE  s.deleted_at IS NULL
      AND  s.erp_status = ${ERP_STATUS_SALE}
      AND  ${inRange(SALE_AT, range)}
  )
`;

/**
 * Attributed sale totalled per route: `route_sales(route_id, amount, units,
 * invoices)`. Emits `attributed_sales` as well, since it is built on it; a
 * query that needs both uses this one alone.
 */
export const routeSalesCte = (range: DateSpan): Prisma.Sql => Prisma.sql`
  ${attributedSalesCte(range)},
  route_sales AS (
    SELECT a.route_id,
           COALESCE(SUM(a.amount), 0)     AS amount,
           COALESCE(SUM(a.units), 0)      AS units,
           COUNT(DISTINCT a.erp_sale_id)  AS invoices
    FROM   attributed_sales a
    GROUP  BY a.route_id
  )
`;

/**
 * Attributed sale of one route, or of every route together when `routeId` is
 * omitted, as a single row: amount, units and distinct invoices.
 *
 * Always one row, zeros included, so a route with no sale in the period is a
 * `"0.00"` and never an empty result the caller has to guard. `invoices` is
 * the denominator PCRM-176 divides `amount` by for the route's average
 * ticket; PCRM-178 does not expose it over HTTP but computes it here, so
 * both issues read the same number.
 */
export const routeSalesTotalsSql = (range: DateSpan, routeId?: string): Prisma.Sql => {
  const routeFilter = routeId
    ? Prisma.sql`WHERE rs.route_id = ${routeId}::uuid`
    : Prisma.empty;

  return Prisma.sql`
    WITH ${routeSalesCte(range)}
    SELECT COALESCE(SUM(rs.amount), 0)::numeric(14,2)::text   AS amount,
           COALESCE(SUM(rs.units), 0)::numeric(16,4)::text    AS units,
           COALESCE(SUM(rs.invoices), 0)::int                 AS invoices
    FROM   route_sales rs
    ${routeFilter}
  `;
};

/**
 * Executed route-days per route: `route_days(route_id, days)`.
 *
 * A route-day is a distinct (route assignment, local day) pair with at least
 * one visit, the same unit the company-wide KPI divides by. Counting the
 * assignment and not only the route keeps two sellers working the same route
 * on the same day as two executed days, which is what "ruta ejecutada" means
 * in wireframe 1d.
 */
export const routeDaysCte = (range: DateSpan): Prisma.Sql => Prisma.sql`
  route_days AS (
    SELECT ru.route_id,
           COUNT(DISTINCT (v.route_user_id, (v.started_at AT TIME ZONE ${TZ})::date)) AS days
    FROM   visit v
    JOIN   route_user ru
           ON ru.id = v.route_user_id
    WHERE  v.deleted_at IS NULL
      AND  v.route_user_id IS NOT NULL
      AND  ${inRange(VISIT_AT, range)}
    GROUP  BY ru.route_id
  )
`;
