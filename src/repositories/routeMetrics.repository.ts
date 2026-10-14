import { Client } from '../lib/prisma';
import { DateSpan } from './metrics/fragments.sql';
import { LocalDateRange } from '../lib/localDateRange';
import { Money } from '../domain/types/customer.types';
import {
  RouteCustomerSales,
  RouteProductSales,
  RouteSeller,
  RouteSellerPerformance,
  RouteWeekdaySales,
} from '../domain/types/routeMetrics.types';
import {
  routeMetricsSql,
  routePortfolioCoverageSql,
  routeSellerPerformanceSql,
  routeTopCustomersSql,
  routeTopProductsSql,
  routeWeekdaySalesSql,
} from './metrics/routes.sql';
import { routeSalesTotalsSql } from './metrics/routeSales.sql';

/*
 * Data access of the per-route metrics (PCRM-178). The SQL text lives in
 * ./metrics/routes.sql.ts and ./metrics/routeSales.sql.ts; routeMetrics.
 * service only resolves the period and shapes the rows.
 */

/** Attributed sale of a route (or of every route) as a single row. */
export interface RouteSalesTotals {
  amount: Money;
  /** Distinct invoices behind `amount`. PCRM-176 divides by this. */
  invoices: number;
}

/** A route card as the query returns it; the service derives `change_rate`. */
export interface RouteMetricsRow {
  route_id: string;
  name: string;
  municipality: string | null;
  zone: string | null;
  active: boolean;
  amount: Money;
  previous_amount: Money;
  visit_coverage_rate: number | null;
  sellers: RouteSeller[];
}

export interface RoutePortfolioCoverageRow {
  scheduled_customers: number;
  purchasing_customers: number;
}

/**
 * Attributed sale totals for `range`, for one route or for all of them.
 *
 * The single entry point to the route sale rule (CLAUDE.md 5.4): PCRM-176
 * computes the route's average ticket as `amount / invoices` by calling this,
 * instead of writing the attribution joins again.
 */
export const findRouteSalesTotals = async (
  client: Client,
  range: DateSpan,
  routeId?: string
): Promise<RouteSalesTotals> => {
  const rows = await client.$queryRaw<RouteSalesTotals[]>(routeSalesTotalsSql(range, routeId));

  // The query aggregates, so it always answers; the fallback only guards
  // against a caller mocking an empty result.
  return rows[0] ?? { amount: '0.00', invoices: 0 };
};

/** Every route with its card metrics, best amount first, or only `routeId`. */
export const findRouteMetrics = (
  client: Client,
  range: LocalDateRange,
  previous: LocalDateRange,
  routeId?: string
): Promise<RouteMetricsRow[]> =>
  client.$queryRaw<RouteMetricsRow[]>(routeMetricsSql(range, previous, routeId));

/** Top `limit` customers of the route by attributed amount. */
export const findRouteTopCustomers = (
  client: Client,
  range: LocalDateRange,
  routeId: string,
  limit: number
): Promise<RouteCustomerSales[]> =>
  client.$queryRaw<RouteCustomerSales[]>(routeTopCustomersSql(range, routeId, limit));

/** Top `limit` products of the route by attributed amount. */
export const findRouteTopProducts = (
  client: Client,
  range: LocalDateRange,
  routeId: string,
  limit: number
): Promise<RouteProductSales[]> =>
  client.$queryRaw<RouteProductSales[]>(routeTopProductsSql(range, routeId, limit));

/** Attributed amount per local weekday: always seven rows, Sunday first. */
export const findRouteWeekdaySales = (
  client: Client,
  range: LocalDateRange,
  routeId: string
): Promise<RouteWeekdaySales[]> =>
  client.$queryRaw<RouteWeekdaySales[]>(routeWeekdaySalesSql(range, routeId));

/** What each seller sold on the route in the period. */
export const findRouteSellerPerformance = (
  client: Client,
  range: LocalDateRange,
  routeId: string
): Promise<RouteSellerPerformance[]> =>
  client.$queryRaw<RouteSellerPerformance[]>(routeSellerPerformanceSql(range, routeId));

/** Customers on the route's agenda in the range, and how many of them bought. */
export const findRoutePortfolioCoverage = async (
  client: Client,
  range: LocalDateRange,
  routeId: string
): Promise<RoutePortfolioCoverageRow> => {
  const rows = await client.$queryRaw<RoutePortfolioCoverageRow[]>(
    routePortfolioCoverageSql(range, routeId)
  );

  return rows[0] ?? { scheduled_customers: 0, purchasing_customers: 0 };
};
