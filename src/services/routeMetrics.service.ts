import { Client } from '../lib/prisma';
import { CustomError } from '../domain/errors/CustomError';
import { MetricsRangeQuery } from '../domain/schemas/metrics.schema';
import { ROUTE_TOP_LIMIT } from '../domain/schemas/routeMetrics.schema';
import {
  MetricsRouteDetailResponse,
  MetricsRoutesResponse,
  RouteMetrics,
  RoutePortfolioCoverage,
} from '../domain/types/routeMetrics.types';
import { previousRange } from '../lib/localDateRange';
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
import { buildContext } from './metrics.service';

/*
 * Per-route metrics (PCRM-178):
 *
 *     GET /api/v1/metrics/routes      -> listRouteMetrics (the route cards)
 *     GET /api/v1/metrics/routes/:id  -> getRouteMetricsDetail
 *
 * Every figure of sale comes from the attribution rule of CLAUDE.md 5.4,
 * written once in repositories/metrics/routeSales.sql.ts: a sale belongs to
 * the route its visit's stop was generated from. This service resolves the
 * period, turns the rows into the response and does the divisions that need
 * a "no data" answer instead of a zero.
 *
 * Average ticket per route is PCRM-176, not this issue. The invoice count it
 * divides by comes from `findRouteSalesTotals`.
 */

/** Every route as a card: attributed sale, variation, visit coverage and sellers. */
export const listRouteMetrics = async (
  client: Client,
  query: MetricsRangeQuery,
  now: Date = new Date()
): Promise<MetricsRoutesResponse> => {
  const { range, context } = buildContext(query, now);
  const previous = previousRange(range);

  const [rows, totals] = await Promise.all([
    findRouteMetrics(client, range, previous),
    findRouteSalesTotals(client, range),
  ]);

  return {
    ...context,
    previous_period: { from: previous.from, to: previous.to },
    routes: rows.map(toRouteMetrics),
    total_amount: totals.amount,
  };
};

/** One route: its card plus portfolio coverage, top lists, weekdays and sellers. */
export const getRouteMetricsDetail = async (
  client: Client,
  routeId: string,
  query: MetricsRangeQuery,
  now: Date = new Date()
): Promise<MetricsRouteDetailResponse> => {
  const { range, context } = buildContext(query, now);
  const previous = previousRange(range);

  const [rows, coverage, topCustomers, topProducts, salesByWeekday, sellerPerformance] =
    await Promise.all([
      findRouteMetrics(client, range, previous, routeId),
      findRoutePortfolioCoverage(client, range, routeId),
      findRouteTopCustomers(client, range, routeId, ROUTE_TOP_LIMIT),
      findRouteTopProducts(client, range, routeId, ROUTE_TOP_LIMIT),
      findRouteWeekdaySales(client, range, routeId),
      findRouteSellerPerformance(client, range, routeId),
    ]);

  if (rows.length === 0) {
    throw CustomError.notFound('Route not found');
  }

  return {
    ...context,
    previous_period: { from: previous.from, to: previous.to },
    route: toRouteMetrics(rows[0]),
    portfolio_coverage: portfolioCoverage(coverage),
    top_customers: topCustomers,
    top_products: topProducts,
    sales_by_weekday: salesByWeekday,
    seller_performance: sellerPerformance,
  };
};

/*
 * ============================================================================
 * Helpers.
 * ============================================================================
 */

const toRouteMetrics = (row: RouteMetricsRow): RouteMetrics => ({
  ...row,
  change_rate: changeRate(row.previous_amount, row.amount),
});

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

/** Share of the agenda's customers that bought. Null without agenda. */
const portfolioCoverage = (row: RoutePortfolioCoverageRow): RoutePortfolioCoverage => ({
  ...row,
  rate:
    row.scheduled_customers === 0
      ? null
      : Math.round((row.purchasing_customers / row.scheduled_customers) * 1000) / 10,
});
