import { Prisma } from '../../generated/prisma/client';
import { CASH_PAYMENT_ID, ERP_STATUS_SALE } from '../../domain/constants/businessRules';
import { DateSpan, SALE_AT, VISIT_AT, inRange } from '../metrics/fragments.sql';
import { attributedSalesCte } from '../metrics/routeSales.sql';

/*
 * Building blocks of the management reports (PCRM-159). Every report query
 * starts from one of the CTEs below, so the three filters (zone, seller,
 * route) mean the same thing in every file.
 *
 * Route attribution is NOT redefined here: sales get their route from
 * `attributedSalesCte` (repositories/metrics/routeSales.sql.ts), the single
 * definition of "sale of a route" (CLAUDE.md 5.4), joined with LEFT JOIN so a
 * sale without a visit stays in the report with a NULL route ("Sin ruta
 * atribuible"). Zone and municipality are the ones of that route: the
 * importer never fills customer.zone / customer.municipality.
 *
 * Only metrics *fragments* are reused (read-only). Nothing in
 * repositories/metrics/ changes for these reports.
 */

/** The three filters of every management report, already validated. */
export interface ReportFilters {
  zone?: string;
  userId?: string;
  routeId?: string;
}

/**
 * Span covering every sale up to `end`: for reports measured "as of today"
 * (credit balances), where the sale date is not the period.
 */
export const allTimeUntil = (end: Date): DateSpan => ({ start: new Date(0), end });

/**
 * Zone comparison: trimmed and case-insensitive, because route.zone is free
 * text typed in the route form ("Norte", "norte ").
 */
const zoneMatches = (column: Prisma.Sql, zone: string): Prisma.Sql =>
  Prisma.sql`lower(btrim(${column})) = lower(btrim(${zone}))`;

/**
 * The filters as `AND ...` predicates over a row that exposes a seller, a
 * route id and a route zone. Columns are trusted SQL references.
 */
export const filterPredicates = (
  filters: ReportFilters,
  columns: { userId: Prisma.Sql; routeId: Prisma.Sql; zone: Prisma.Sql }
): Prisma.Sql => {
  const parts: Prisma.Sql[] = [];
  if (filters.userId) parts.push(Prisma.sql`AND ${columns.userId} = ${filters.userId}::uuid`);
  if (filters.routeId) parts.push(Prisma.sql`AND ${columns.routeId} = ${filters.routeId}::uuid`);
  if (filters.zone) parts.push(Prisma.sql`AND ${zoneMatches(columns.zone, filters.zone)}`);
  return parts.length > 0 ? Prisma.join(parts, ' ') : Prisma.empty;
};

/**
 * `report_sales`: confirmed sales inside `span` (by erp_created_at, the date
 * every sales metric uses), one row per sale, with the attributed route, its
 * zone and municipality, and the filters applied.
 *
 * Needs `attributed_sales` in the same WITH: use `reportSalesCtes`.
 */
const reportSalesCte = (span: DateSpan, filters: ReportFilters): Prisma.Sql => Prisma.sql`
  report_sales AS (
    SELECT s.erp_sale_id,
           s.customer_id,
           s.user_id,
           s.erp_created_at,
           s.total        AS amount,
           a.route_id,
           r.name         AS route_name,
           r.zone         AS zone,
           r.municipality AS municipality
    FROM   sale s
    LEFT   JOIN attributed_sales a
           ON a.erp_sale_id = s.erp_sale_id
    LEFT   JOIN route r
           ON r.id = a.route_id
    WHERE  s.deleted_at IS NULL
      AND  s.erp_status = ${ERP_STATUS_SALE}
      AND  ${inRange(SALE_AT, span)}
      ${filterPredicates(filters, {
        userId: Prisma.raw('s.user_id'),
        routeId: Prisma.raw('a.route_id'),
        zone: Prisma.raw('r.zone'),
      })}
  )
`;

/** `attributed_sales, report_sales`, ready to follow a WITH. */
export const reportSalesCtes = (span: DateSpan, filters: ReportFilters): Prisma.Sql => Prisma.sql`
  ${attributedSalesCte(span)},
  ${reportSalesCte(span, filters)}
`;

/**
 * `report_credit_sales`: every confirmed credit sale (cash excluded, the same
 * criterion as the overdue_portfolio and pending_collections KPIs), whatever
 * its date, with its attributed route and the filters applied. Base of the
 * collections and overdue-portfolio reports, which are measured as of today.
 */
export const reportCreditSalesCtes = (end: Date, filters: ReportFilters): Prisma.Sql => Prisma.sql`
  ${attributedSalesCte(allTimeUntil(end))},
  report_credit_sales AS (
    SELECT s.erp_sale_id,
           s.customer_id,
           s.user_id,
           s.erp_created_at,
           s.document,
           s.total,
           s.pending_balance,
           a.route_id,
           r.name AS route_name,
           r.zone AS zone
    FROM   sale s
    LEFT   JOIN attributed_sales a
           ON a.erp_sale_id = s.erp_sale_id
    LEFT   JOIN route r
           ON r.id = a.route_id
    WHERE  s.deleted_at IS NULL
      AND  s.erp_status = ${ERP_STATUS_SALE}
      AND  (s.payment_id IS NULL OR s.payment_id <> ${CASH_PAYMENT_ID})
      ${filterPredicates(filters, {
        userId: Prisma.raw('s.user_id'),
        routeId: Prisma.raw('a.route_id'),
        zone: Prisma.raw('r.zone'),
      })}
  )
`;

/**
 * `report_visits`: visits started inside `span`, with the route of the
 * assignment they ran under (the visit's own route_user, or the one of the
 * stop it executed) and the filters applied. Prospect visits included.
 */
export const reportVisitsCte = (span: DateSpan, filters: ReportFilters): Prisma.Sql => Prisma.sql`
  report_visits AS (
    SELECT v.id,
           v.user_id,
           v.customer_id,
           v.prospect_id,
           v.visit_type,
           v.successful,
           v.scheduled_visit_id,
           v.started_at,
           ru.route_id,
           r.name AS route_name,
           r.zone AS zone
    FROM   visit v
    LEFT   JOIN scheduled_visit sv
           ON sv.id = v.scheduled_visit_id
    LEFT   JOIN route_user ru
           ON ru.id = COALESCE(v.route_user_id, sv.route_user_id)
    LEFT   JOIN route r
           ON r.id = ru.route_id
    WHERE  v.deleted_at IS NULL
      AND  ${inRange(VISIT_AT, span)}
      ${filterPredicates(filters, {
        userId: Prisma.raw('v.user_id'),
        routeId: Prisma.raw('ru.route_id'),
        zone: Prisma.raw('r.zone'),
      })}
  )
`;
