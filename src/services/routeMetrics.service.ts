import { Client } from '../lib/prisma';
import { CustomError } from '../domain/errors/CustomError';
import { MetricsRangeQuery } from '../domain/schemas/metrics.schema';
import {
  MetricsRouteWorkdaysQuery,
  ROUTE_TOP_LIMIT,
} from '../domain/schemas/routeMetrics.schema';
import {
  MetricsRouteDetailResponse,
  MetricsRoutesResponse,
  MetricsRouteWorkdaysResponse,
  RouteMetrics,
  RoutePortfolioCoverage,
  RouteWorkday,
  RouteWorkdayBaseline,
} from '../domain/types/routeMetrics.types';
import { localToday, previousRange, resolveRange } from '../lib/localDateRange';
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
  findRouteWorkdayDates,
  findRouteWorkdayHeader,
  findRouteWorkdayMetrics,
} from '../repositories/routeMetrics.repository';
import { buildContext } from './metrics.service';

/*
 * Per-route metrics (PCRM-178):
 *
 *     GET /api/v1/metrics/routes      -> listRouteMetrics (the route cards)
 *     GET /api/v1/metrics/routes/:id  -> getRouteMetricsDetail
 *     GET /api/v1/metrics/routes/:id/workdays -> getRouteWorkdayComparison (PCRM-188)
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

/**
 * The route against itself on the same weekday (PCRM-188): its latest
 * `limit` workdays, newest first, and the latest one against the average of
 * the others.
 *
 * Without `day`, the weekday of the route's latest workday is used, which is
 * what "this Tuesday against previous Tuesdays" means when the dashboard
 * opens; a route that never had an agenda falls back to today's weekday and
 * answers with no workdays. The comparison runs even if the seller changed:
 * each workday carries its sellers so the dashboard can say so.
 */
export const getRouteWorkdayComparison = async (
  client: Client,
  routeId: string,
  query: MetricsRouteWorkdaysQuery,
  now: Date = new Date()
): Promise<MetricsRouteWorkdaysResponse> => {
  const today = localToday(now);
  const header = await findRouteWorkdayHeader(client, routeId, today);

  if (!header) {
    throw CustomError.notFound('Route not found');
  }

  const day = query.day ?? header.latest_day ?? isoWeekday(today);
  const route = { route_id: header.route_id, name: header.name, active: header.active };
  const dates = await findRouteWorkdayDates(client, routeId, day, today, query.limit);

  if (dates.length === 0) {
    return { route, day, limit: query.limit, workdays: [], baseline: null, change_rate: null };
  }

  // Up to today and not to the latest workday: a stop's sale may be invoiced
  // a day later and still belongs to the workday whose visit made it.
  const span = resolveRange(dates[dates.length - 1], today);
  const workdays = await findRouteWorkdayMetrics(client, routeId, dates, span);
  const baseline = workdayBaseline(workdays.slice(1));

  return {
    route,
    day,
    limit: query.limit,
    workdays,
    baseline,
    change_rate: baseline ? changeRate(baseline.amount, workdays[0].amount) : null,
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

/** ISO weekday (1 Monday … 7 Sunday) of a `YYYY-MM-DD` day. */
const isoWeekday = (isoDate: string): number => {
  const weekday = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
};

const round1 = (value: number): number => Math.round(value * 10) / 10;

/** Average of the rates that exist; null when no workday has one. */
const averageRate = (rates: (number | null)[]): number | null => {
  const present = rates.filter((rate): rate is number => rate !== null);
  return present.length === 0
    ? null
    : round1(present.reduce((sum, rate) => sum + rate, 0) / present.length);
};

/** Average of the previous workdays. Null when there are none. */
const workdayBaseline = (previous: RouteWorkday[]): RouteWorkdayBaseline | null => {
  if (previous.length === 0) return null;

  const amount = previous.reduce((sum, workday) => sum + Number(workday.amount), 0);
  const orders = previous.reduce((sum, workday) => sum + workday.orders_count, 0);

  return {
    workdays: previous.length,
    amount: (amount / previous.length).toFixed(2),
    orders_count: round1(orders / previous.length),
    visit_coverage_rate: averageRate(previous.map((workday) => workday.visit_coverage_rate)),
    order_rate: averageRate(previous.map((workday) => workday.order_rate)),
  };
};
