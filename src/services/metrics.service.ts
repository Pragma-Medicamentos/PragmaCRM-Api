import { Client } from '../lib/prisma';
import { envs } from '../config/envs';
import { CustomError } from '../domain/errors/CustomError';
import { CREDIT_TERM_DAYS } from '../domain/constants/businessRules';
import { PURCHASE_FREQUENCY_BUCKETS } from '../domain/constants/metrics';
import {
  KPI_NAMES,
  KpiName,
  MetricsKpisQuery,
  MetricsRangeQuery,
  MetricsTrendsQuery,
} from '../domain/schemas/metrics.schema';
import {
  CompanyKpis,
  CoverageCustomer,
  KpiValue,
  MetricsContext,
  MetricsCoverageResponse,
  MetricsKpisResponse,
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
  PeriodKpiRow,
  SellerRow,
  SnapshotKpiRow,
  findCoverage,
  findPeriodKpis,
  findPurchaseFrequencyBuckets,
  findSellerInactiveCustomers,
  findSellerPerformance,
  findSnapshotKpis,
  findTrends,
} from '../repositories/metrics.repository';
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
 *      GET /api/v1/metrics/kpis                -> getCompanyKpis
 *      GET /api/v1/metrics/sellers             -> listSellerPerformance
 *      GET /api/v1/metrics/sellers/:id         -> getSellerDetail
 *      GET /api/v1/metrics/trends              -> getTrends
 *      GET /api/v1/metrics/coverage            -> getCoverage
 *      GET /api/v1/metrics/purchase-frequency  -> getPurchaseFrequency
 * ============================================================================
 */

/**
 * Summary cards (1a) and panel header (1d, 1v), with previous-period deltas.
 *
 * `query.kpis` narrows the response to the cards a screen shows (the Home
 * needs 4 of 17). The period KPIs come from one query per period, so the
 * selection mostly trims the payload; it does skip whole queries when every
 * requested KPI is a snapshot, or none is.
 */
export const getCompanyKpis = async (
  client: Client,
  query: MetricsKpisQuery,
  now: Date = new Date()
): Promise<MetricsKpisResponse> => {
  const { range, context } = buildContext(query, now);
  const inactivityDays = context.thresholds.inactivity_days;
  const previous = previousRange(range);

  const selected = query.kpis ?? [...KPI_NAMES];
  const needsPeriod = selected.some((name) => !SNAPSHOT_KPIS.has(name));
  const needsSnapshot = selected.some((name) => SNAPSHOT_KPIS.has(name));

  const [current, previousRow, snapshot] = await Promise.all([
    needsPeriod ? findPeriodKpis(client, range, inactivityDays, now) : undefined,
    needsPeriod ? findPeriodKpis(client, previous, inactivityDays, now) : undefined,
    needsSnapshot ? findSnapshotKpis(client) : undefined,
  ]);

  const all = mapCompanyKpis(current, previousRow, snapshot);

  return {
    ...context,
    previous_period: { from: previous.from, to: previous.to },
    kpis: pickKpis(all, selected),
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

/** KPIs that describe today rather than the period, from findSnapshotKpis. */
const SNAPSHOT_KPIS: ReadonlySet<KpiName> = new Set<KpiName>([
  'overdue_portfolio',
  'pending_collections',
]);

/** Keeps the requested KPIs, in the order the client asked for them. */
const pickKpis = (
  all: Partial<CompanyKpis>,
  selected: KpiName[]
): Partial<CompanyKpis> =>
  Object.fromEntries(
    selected.map((name) => [name, all[name]])
  ) as Partial<CompanyKpis>;

const kpi = <T>(value: T, previous: T | null): KpiValue<T> => ({
  value,
  previous_value: previous,
});

/**
 * Maps whichever rows were fetched. A group whose query was skipped (see
 * getCompanyKpis) is left out, never filled with fake zeros.
 */
const mapCompanyKpis = (
  current: PeriodKpiRow | undefined,
  previous: PeriodKpiRow | undefined,
  snapshot: SnapshotKpiRow | undefined
): Partial<CompanyKpis> => ({
  ...(current && previous ? mapPeriodKpis(current, previous) : {}),
  ...(snapshot ? mapSnapshotKpis(snapshot) : {}),
});

const mapPeriodKpis = (
  current: PeriodKpiRow,
  previous: PeriodKpiRow
): Omit<CompanyKpis, 'overdue_portfolio' | 'pending_collections'> => ({
  stops_executed: kpi(current.stops_executed, previous.stops_executed),
  stops_by_type: kpi(stopsByType(current), stopsByType(previous)),
  visited_customers: kpi(current.visited_customers, previous.visited_customers),
  effective_visits_rate: kpi(current.effective_visits_rate, previous.effective_visits_rate),
  average_visit_minutes: kpi(current.average_visit_minutes, previous.average_visit_minutes),
  total_sales: kpi(current.total_sales, previous.total_sales),
  orders_count: kpi(current.orders_count, previous.orders_count),
  average_ticket: kpi(current.average_ticket, previous.average_ticket),
  average_monthly_sales: kpi(current.average_monthly_sales, previous.average_monthly_sales),
  route_effectiveness: kpi(current.route_effectiveness, previous.route_effectiveness),
  goal_compliance: kpi(current.goal_compliance, previous.goal_compliance),
  customers_without_visit: kpi(current.customers_without_visit, previous.customers_without_visit),
  recovered_customers: kpi(current.recovered_customers, previous.recovered_customers),
  new_prospects: kpi(current.new_prospects, previous.new_prospects),
  purchase_frequency_days: kpi(current.purchase_frequency_days, previous.purchase_frequency_days),
});

// Snapshots describe today: there is no previous period to compare with.
const mapSnapshotKpis = (
  snapshot: SnapshotKpiRow
): Pick<CompanyKpis, 'overdue_portfolio' | 'pending_collections'> => ({
  overdue_portfolio: kpi(snapshot.overdue_portfolio, null),
  pending_collections: kpi(snapshot.pending_collections, null),
});

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
