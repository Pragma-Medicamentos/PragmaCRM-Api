import { Prisma } from '../generated/prisma/client';
import { Client } from '../lib/prisma';
import { envs } from '../config/envs';
import { CustomError } from '../domain/errors/CustomError';
import { CREDIT_TERM_DAYS } from '../domain/constants/businessRules';
import { MetricsRangeQuery } from '../domain/schemas/metrics.schema';
import { ROUTE_TOP_LIMIT } from '../domain/schemas/routeMetrics.schema';
import { MetricsContext } from '../domain/types/metrics.types';
import {
  MetricsRouteDetailResponse,
  MetricsRouteTicketResponse,
  MetricsRoutesResponse,
  RouteMetrics,
  RoutePortfolioCoverage,
} from '../domain/types/routeMetrics.types';
import { LocalDateRange, previousRange, resolveRange } from '../lib/localDateRange';
import {
  RouteMetricsRow,
  RoutePortfolioCoverageRow,
  findRouteMetrics,
  findRoutePortfolioCoverage,
  findRouteSalesTotals,
  findRouteSellerPerformance,
  findRouteTopCustomers,
  findRouteTopProducts,
  findRouteWeekdaySales,
} from '../repositories/routeMetrics.repository';
import { getRouteById } from './route.service';
import { GPS_RADIUS_METERS } from './visit.service';

/*
 * Per-route metrics (PCRM-178), the route counterpart of the seller table:
 *
 *     GET /api/v1/metrics/routes             -> listRouteMetrics
 *     GET /api/v1/metrics/routes/:id         -> getRouteMetricsDetail
 *     GET /api/v1/metrics/routes/:id/ticket  -> getRouteAverageTicket
 *
 * Every figure of sale comes from the attribution rule of CLAUDE.md 5.4,
 * written once in repositories/metrics/routeSales.sql.ts and shared with the
 * company-wide KPI `route_effectiveness`. This service resolves the period,
 * turns the rows into the response and does the divisions that need a
 * "no data" answer instead of a zero.
 *
 * Average ticket per route is PCRM-176: it answers on its own endpoint and
 * neither the ranking nor the detail carries `average_ticket`. It divides
 * the same `findRouteSalesTotals` row both of them already use, so the three
 * endpoints can never disagree on what the route sold.
 */

/** Ranking of routes by attributed sale. Routes with no activity come as zeros. */
export const listRouteMetrics = async (
  client: Client,
  query: MetricsRangeQuery,
  now: Date = new Date()
): Promise<MetricsRoutesResponse> => {
  const { range, context } = buildContext(query, now);
  const rows = await findRouteMetrics(client, range);

  return {
    ...context,
    routes: rows.map(stripTotals),
    // The totals travel on every row and are identical on all of them; with
    // no routes at all there is nothing to sell, hence the zeros.
    total_amount: rows[0]?.total_amount ?? '0.00',
    total_units: rows[0]?.total_units ?? '0.0000',
  };
};

/** Expanded route: ranking row, trend, coverage, top lists and sellers. */
export const getRouteMetricsDetail = async (
  client: Client,
  routeId: string,
  query: MetricsRangeQuery,
  now: Date = new Date()
): Promise<MetricsRouteDetailResponse> => {
  const { range, context } = buildContext(query, now);
  const previous = previousRange(range);

  const [
    rows,
    previousTotals,
    coverage,
    topCustomers,
    topProducts,
    salesByWeekday,
    sellerPerformance,
  ] = await Promise.all([
    findRouteMetrics(client, range, routeId),
    findRouteSalesTotals(client, previous, routeId),
    findRoutePortfolioCoverage(client, range, routeId),
    findRouteTopCustomers(client, range, routeId, ROUTE_TOP_LIMIT),
    findRouteTopProducts(client, range, routeId, ROUTE_TOP_LIMIT),
    findRouteWeekdaySales(client, range, routeId),
    findRouteSellerPerformance(client, range, routeId),
  ]);

  if (rows.length === 0) {
    throw CustomError.notFound('Route not found');
  }

  const route = stripTotals(rows[0]);

  return {
    ...context,
    route,
    previous: {
      period: { from: previous.from, to: previous.to },
      amount: previousTotals.amount,
      change_rate: changeRate(previousTotals.amount, route.amount),
    },
    portfolio_coverage: portfolioCoverage(coverage),
    top_customers: topCustomers,
    top_products: topProducts,
    sales_by_weekday: salesByWeekday,
    seller_performance: sellerPerformance,
  };
};

/**
 * Average ticket of a route: attributed sale divided by the invoices behind
 * it (PCRM-176).
 *
 * The amount and the denominator come from `findRouteSalesTotals`, the same
 * row the ranking and the detail read, so this endpoint cannot drift from
 * them. Only the division is new.
 */
export const getRouteAverageTicket = async (
  client: Client,
  routeId: string,
  query: MetricsRangeQuery,
  now: Date = new Date()
): Promise<MetricsRouteTicketResponse> => {
  // A route that does not exist is a 404, like the detail: answering zeros
  // would read as "this route sold nothing", which is a different fact.
  await getRouteById(client, routeId);

  const range = resolveRange(query.from, query.to, now);
  const totals = await findRouteSalesTotals(client, range, routeId);

  return {
    route_id: routeId,
    period: { from: range.from, to: range.to },
    amount: totals.amount,
    invoices: totals.invoices,
    average_ticket: averageTicket(totals.amount, totals.invoices),
  };
};

/*
 * ============================================================================
 * Helpers.
 * ============================================================================
 */

/**
 * Period and thresholds in force for the request, the block every metrics
 * response opens with. It repeats the one in metrics.service.ts on purpose:
 * that one is private to its module and PCRM-177 is editing the file in
 * parallel. Worth unifying once both land.
 */
const buildContext = (
  query: MetricsRangeQuery,
  now: Date
): { range: LocalDateRange; context: MetricsContext } => {
  const range = resolveRange(query.from, query.to, now);

  return {
    range,
    context: {
      period: { from: range.from, to: range.to },
      thresholds: {
        inactivity_days: query.inactivity_days ?? envs.INACTIVITY_THRESHOLD_DAYS,
        credit_term_days: CREDIT_TERM_DAYS,
        gps_radius_meters: GPS_RADIUS_METERS,
      },
    },
  };
};

/** The period totals ride along every row; the response carries them once. */
const stripTotals = ({
  total_amount: _amount,
  total_units: _units,
  ...route
}: RouteMetricsRow): RouteMetrics => route;

/**
 * Percentage change of `current` against `previous`. Null when the previous
 * period sold nothing: growing from zero has no rate, and reporting 100 %
 * (or dividing by zero) would be a made-up number.
 */
const changeRate = (previous: string, current: string): number | null => {
  const before = Number(previous);
  const after = Number(current);

  if (!Number.isFinite(before) || !Number.isFinite(after) || before === 0) return null;

  return Math.round(((after - before) / before) * 1000) / 10;
};

/** Share of the route's portfolio that bought. Null without portfolio. */
const portfolioCoverage = (row: RoutePortfolioCoverageRow): RoutePortfolioCoverage => ({
  ...row,
  rate:
    row.assigned_customers === 0
      ? null
      : Math.round((row.purchasing_customers / row.assigned_customers) * 1000) / 10,
});

/**
 * `amount / invoices` with the two decimals of the rest of the panel. Null
 * without invoices: a route with no sale has no ticket, and reporting
 * "0.00" would pass for a route that sold and averaged zero.
 */
const averageTicket = (amount: string, invoices: number): string | null =>
  invoices === 0 ? null : new Prisma.Decimal(amount).div(invoices).toFixed(2);
