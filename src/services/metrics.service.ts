import { Client } from '../lib/prisma';
import { envs } from '../config/envs';
import { logger } from '../lib/adapters/logger';
import { CustomError } from '../domain/errors/CustomError';
import { CREDIT_TERM_DAYS } from '../domain/constants/businessRules';
import { KPI_CATALOG } from '../domain/constants/kpiCatalog';
import { PURCHASE_FREQUENCY_BUCKETS } from '../domain/constants/metrics';
import {
  KPI_NAMES,
  KpiName,
  MetricsKpiValuesQuery,
  MetricsProductsQuery,
  MetricsRangeQuery,
  MetricsTrendsQuery,
} from '../domain/schemas/metrics.schema';
import {
  CoverageCustomer,
  MetricsContext,
  MetricsCoverageResponse,
  MetricsKpiCatalogResponse,
  MetricsKpiResponse,
  MetricsKpiValuesResponse,
  MetricsProductsResponse,
  MetricsPurchaseFrequencyResponse,
  MetricsSellerDetailResponse,
  MetricsSellersResponse,
  MetricsTrendsResponse,
  SellerPerformance,
} from '../domain/types/metrics.types';
import {
  LocalDateRange,
  previousRange,
  referenceInstant,
  resolveRange,
} from '../lib/localDateRange';
import {
  SellerRow,
  findCoverage,
  findKpi,
  findProductRanking,
  findPurchaseFrequencyBuckets,
  findSellerInactiveCustomers,
  findSellerPerformance,
  findTrends,
} from '../repositories/metrics.repository';
import { KpiWindow } from '../repositories/metrics/fragments.sql';
import { GPS_RADIUS_METERS } from './visit.service';

/*
 * Metrics engine of the base KPI panel (RF-09, PCRM-13).
 *
 * Every figure is computed on the fly: the database is small (CLAUDE.md 7.9)
 * and a materialised layer would have to be refreshed on every upload and
 * every visit. This service resolves the period and the thresholds in force
 * and shapes the rows; the SQL lives in repositories/metrics.repository.ts.
 * Formulas and their sources are in docs/METRICS_API.md.
 */

/*
 * ============================================================================
 * 1. MAIN METHODS — called directly by MetricsController, one per route:
 *
 *      GET /api/v1/metrics/kpis                -> listKpiCatalog
 *      GET /api/v1/metrics/kpis/values         -> getKpiValues
 *      GET /api/v1/metrics/kpis/:name          -> getKpi
 *      GET /api/v1/metrics/sellers             -> listSellerPerformance
 *      GET /api/v1/metrics/sellers/:id         -> getSellerDetail
 *      GET /api/v1/metrics/trends              -> getTrends
 *      GET /api/v1/metrics/coverage            -> getCoverage
 *      GET /api/v1/metrics/products            -> getProductRanking
 *      GET /api/v1/metrics/purchase-frequency  -> getPurchaseFrequency
 * ============================================================================
 */

/** What KPIs exist, their unit and threshold tags. Computes nothing. */
export const listKpiCatalog = (): MetricsKpiCatalogResponse => ({
  kpis: KPI_NAMES.map((name) => ({ name, ...KPI_CATALOG[name] })),
});

/**
 * Cards of a screen in one request (1a, 1d, 1v). Runs only the requested
 * KPIs, each with its own query, in parallel; omitted `names` means all 17.
 *
 * A failing KPI does not sink the batch: it comes back as `{ error }` and is
 * logged, the rest arrive normally. Only when every KPI fails is it a 500,
 * since then the problem is not one query.
 */
export const getKpiValues = async (
  client: Client,
  query: MetricsKpiValuesQuery,
  now: Date = new Date()
): Promise<MetricsKpiValuesResponse> => {
  const { window, context } = buildKpiContext(query, now);
  const names = query.names ?? [...KPI_NAMES];

  const results = await Promise.allSettled(
    names.map((name) => findKpi(client, name, window))
  );

  if (results.every((result) => result.status === 'rejected')) {
    throw (results[0] as PromiseRejectedResult).reason;
  }

  // Assigned by name in the order requested, so the payload keeps that order.
  const kpis: Record<string, unknown> = {};
  results.forEach((result, index) => {
    const name = names[index];
    if (result.status === 'fulfilled') {
      kpis[name] = result.value;
      return;
    }
    logger.error('KPI computation failed', {
      kpi: name,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
    kpis[name] = { error: 'KPI could not be computed' };
  });

  return {
    ...context,
    previous_period: periodOf(window.previous),
    kpis: kpis as MetricsKpiValuesResponse['kpis'],
  };
};

/** A single KPI, to refresh one card. An unknown name is a 404. */
export const getKpi = async (
  client: Client,
  name: string,
  query: MetricsRangeQuery,
  now: Date = new Date()
): Promise<MetricsKpiResponse> => {
  if (!isKpiName(name)) {
    throw CustomError.notFound(
      `Unknown KPI "${name}". Valid values: ${KPI_NAMES.join(', ')}`
    );
  }

  const { window, context } = buildKpiContext(query, now);
  const { value, previous_value } = await findKpi(client, name, window);
  const { unit, has_previous_period } = KPI_CATALOG[name];

  return {
    ...context,
    name,
    unit,
    has_previous_period,
    previous_period: has_previous_period ? periodOf(window.previous) : null,
    value,
    previous_value,
  };
};

/** Table "Desempeño por vendedor" (1d) and the collapsed rows of 1f. */
export const listSellerPerformance = async (
  client: Client,
  query: MetricsRangeQuery,
  now: Date = new Date()
): Promise<MetricsSellersResponse> => {
  const { range, context } = buildContext(query, now);
  const rows = await findSellerPerformance(client, range);

  return { ...context, sellers: rows.map(mapSellerRow) };
};

/** Expanded row of 1f: performance, weekly trend and forgotten customers. */
export const getSellerDetail = async (
  client: Client,
  sellerId: string,
  query: MetricsRangeQuery,
  now: Date = new Date()
): Promise<MetricsSellerDetailResponse> => {
  const { range, context } = buildContext(query, now);
  const referenceAt = referenceInstant(range, now);

  const [sellerRows, weeklyTrend, inactiveCustomers] = await Promise.all([
    findSellerPerformance(client, range, sellerId),
    findTrends(client, range, 'week', sellerId),
    findSellerInactiveCustomers(
      client,
      sellerId,
      referenceAt,
      context.thresholds.inactivity_days
    ),
  ]);

  if (sellerRows.length === 0) {
    throw CustomError.notFound('Seller not found');
  }

  return {
    ...context,
    seller: mapSellerRow(sellerRows[0]),
    weekly_trend: weeklyTrend,
    customers_without_visit: inactiveCustomers,
  };
};

/** Charts "Paradas por semana" and "Ticket promedio" (1e) and the Home chart. */
export const getTrends = async (
  client: Client,
  query: MetricsTrendsQuery,
  now: Date = new Date()
): Promise<MetricsTrendsResponse> => {
  const { range, context } = buildContext(query, now);
  const points = await findTrends(client, range, query.granularity);

  return { ...context, granularity: query.granularity, points };
};

/** Map "Cobertura de cartera" (1e): visited vs. not visited in the period. */
export const getCoverage = async (
  client: Client,
  query: MetricsRangeQuery,
  now: Date = new Date()
): Promise<MetricsCoverageResponse> => {
  const { range, context } = buildContext(query, now);
  const rows = await findCoverage(client, range);

  const visited = rows.filter((row) => row.visited).length;
  const customers: CoverageCustomer[] = rows
    .filter((row) => row.lat !== null && row.lng !== null)
    .map((row) => ({
      customer_id: row.customer_id,
      name: row.name,
      trade_name: row.trade_name,
      lat: row.lat as number,
      lng: row.lng as number,
      visited: row.visited,
      last_visit_at: row.last_visit_at,
    }));

  return {
    ...context,
    visited,
    not_visited: rows.length - visited,
    without_location: rows.length - customers.length,
    customers,
  };
};

/**
 * Ranking "Productos más vendidos" (PCRM-172). `total_amount` covers every
 * product with sales in the period, so the page of top N can be read as a
 * share of the whole; it travels on each row and is the same on all of them.
 */
export const getProductRanking = async (
  client: Client,
  query: MetricsProductsQuery,
  now: Date = new Date()
): Promise<MetricsProductsResponse> => {
  const { range, context } = buildContext(query, now);
  const rows = await findProductRanking(client, range, query.limit);

  return {
    ...context,
    products: rows.map(({ total_amount: _total, ...product }) => product),
    total_amount: rows[0]?.total_amount ?? '0.00',
  };
};

/** Histogram "Frecuencia de compra por cliente" (1e). */
export const getPurchaseFrequency = async (
  client: Client,
  query: MetricsRangeQuery,
  now: Date = new Date()
): Promise<MetricsPurchaseFrequencyResponse> => {
  const { range, context } = buildContext(query, now);
  const row = await findPurchaseFrequencyBuckets(client, range);

  return {
    ...context,
    buckets: PURCHASE_FREQUENCY_BUCKETS.map((bucket, index) => ({
      ...bucket,
      customers: row?.bucket_counts[index] ?? 0,
    })),
    insufficient_data: row?.insufficient_data ?? 0,
    average_days: row?.average_days ?? null,
  };
};

/*
 * ============================================================================
 * 2. OTHER METHODS — context and mapping helpers behind the main methods.
 * ============================================================================
 */

/**
 * Resolves the range and the thresholds in force for this request. The
 * inactivity threshold comes from the query when given, otherwise from the
 * environment, so it can be tuned without touching code.
 */
export const buildContext = (
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

/** Adds the previous period and the inputs every per-KPI query needs. */
const buildKpiContext = (
  query: MetricsRangeQuery,
  now: Date
): { window: KpiWindow; context: MetricsContext } => {
  const { range, context } = buildContext(query, now);

  return {
    context,
    window: {
      range,
      previous: previousRange(range),
      inactivityDays: context.thresholds.inactivity_days,
      now,
    },
  };
};

const periodOf = (range: LocalDateRange) => ({ from: range.from, to: range.to });

const isKpiName = (name: string): name is KpiName =>
  (KPI_NAMES as readonly string[]).includes(name);

const stopsByType = (row: {
  stops_visit: number;
  stops_dispatch: number;
  stops_collection: number;
}) => ({
  visit: row.stops_visit,
  dispatch: row.stops_dispatch,
  collection: row.stops_collection,
});

const mapSellerRow = (row: SellerRow): SellerPerformance => ({
  user_id: row.user_id,
  name: row.name,
  active: row.active,
  stops_executed: row.stops_executed,
  stops_by_type: stopsByType(row),
  visited_customers: row.visited_customers,
  orders_count: row.orders_count,
  total_sales: row.total_sales,
  average_ticket: row.average_ticket,
  goal_amount: row.goal_amount,
  goal_compliance: row.goal_compliance,
  route_sales: row.route_sales,
  executed_route_days: row.executed_route_days,
  sales_per_route: row.sales_per_route,
  dispatches_for_others: row.dispatches_for_others,
  portfolio_customers: row.portfolio_customers,
});
