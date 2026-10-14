import { Prisma } from '../../generated/prisma/client';
import { ERP_STATUS_SALE } from '../../domain/constants/businessRules';
import { DateSpan, SALE_AT, inRange } from './fragments.sql';

/*
 * Route sale attribution: the single definition of "sale of a route"
 * (CLAUDE.md 5.4, PCRM-178).
 *
 * A route's history is its agenda: every stop is a `scheduled_visit` hanging
 * from the assignment (`route_user`) that generated it, and every visit the
 * app records points at the stop it executed. So a confirmed sale belongs to
 * the route its visit's stop came from:
 *
 *   sale.visit_id -> visit.scheduled_visit_id -> scheduled_visit.route_user_id
 *                 -> route_user.route_id
 *
 * The chain survives later changes to the route: reassigning the day
 * (soft-deleted `route_user`) or editing its customers (`route_customer`)
 * does not move sales that were already made. A sale without a visit, or
 * whose visit has no stop behind it, is not route sale (Anexo A.2), so the
 * per-route figures add up to less than `total_sales`.
 *
 * Every per-route query of the module builds on `attributedSalesCte` instead
 * of repeating the joins, so the rule can only change in one place. PCRM-176
 * (average ticket per route) reads `routeSalesTotalsSql` for the same reason.
 */

/** One row per sale attributed to a route, with the route it belongs to. */
export const attributedSalesCte = (range: DateSpan): Prisma.Sql => Prisma.sql`
  attributed_sales AS (
    SELECT ru.route_id,
           s.erp_sale_id,
           s.customer_id,
           s.user_id,
           s.erp_created_at,
           s.total AS amount
    FROM   sale s
    JOIN   visit v
           ON v.id = s.visit_id
          AND v.deleted_at IS NULL
    JOIN   scheduled_visit sv
           ON sv.id = v.scheduled_visit_id
    JOIN   route_user ru
           ON ru.id = sv.route_user_id
    WHERE  s.deleted_at IS NULL
      AND  s.erp_status = ${ERP_STATUS_SALE}
      AND  ${inRange(SALE_AT, range)}
  )
`;

/**
 * Attributed sale of one route, or of every route together when `routeId` is
 * omitted, as a single row: amount and distinct invoices.
 *
 * Always one row, zeros included, so a route with no sale in the period is a
 * `"0.00"` and never an empty result the caller has to guard. `invoices` is
 * the denominator PCRM-176 divides `amount` by for the route's average ticket.
 */
export const routeSalesTotalsSql = (range: DateSpan, routeId?: string): Prisma.Sql => {
  const routeFilter = routeId ? Prisma.sql`WHERE a.route_id = ${routeId}::uuid` : Prisma.empty;

  return Prisma.sql`
    WITH ${attributedSalesCte(range)}
    SELECT COALESCE(SUM(a.amount), 0)::numeric(14,2)::text AS amount,
           COUNT(DISTINCT a.erp_sale_id)::int              AS invoices
    FROM   attributed_sales a
    ${routeFilter}
  `;
};
