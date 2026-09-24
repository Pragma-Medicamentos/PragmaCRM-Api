import { Money } from './customer.types';
import { KpiName } from '../schemas/metrics.schema';

/**
 * Response shapes of the metrics panel (RF-09, PCRM-13).
 *
 * Conventions shared with the rest of the API: snake_case fields, money as a
 * `numeric(14,2)` string (see `Money`), rates as a percentage with one
 * decimal. A null means "not computable for this period" (no sales, no
 * goals, no visits), never zero: 0 would read as a real result.
 */

/** The local days the figures cover, both inclusive (`YYYY-MM-DD`). */
export interface MetricsPeriod {
  from: string;
  to: string;
}

/**
 * Configuration constants the figures depend on, echoed in every response so
 * the dashboard can show them next to the numbers (e.g. a "Threshold: 30 days"
 * tag). Changing any of them changes the indicators retroactively.
 */
export interface MetricsThresholds {
  /** Days without a visit/purchase to count a customer as inactive. */
  inactivity_days: number;
  /** Uniform credit term behind the overdue portfolio (CLAUDE.md 5.6). */
  credit_term_days: number;
  /** GPS validation radius (CLAUDE.md 5.3). */
  gps_radius_meters: number;
}

export interface MetricsContext {
  period: MetricsPeriod;
  thresholds: MetricsThresholds;
}

/** Stops split by the mandatory classification (CLAUDE.md 5.2). */
export interface StopsByType {
  visit: number;
  dispatch: number;
  collection: number;
}

/**
 * A KPI of the selected period next to the same KPI over the previous period
 * of equal length. `previous_value` is null for snapshot KPIs, which describe
 * today and have no previous period.
 */
export interface KpiValue<T> {
  value: T;
  previous_value: T | null;
}

export interface CompanyKpis {
  stops_executed: KpiValue<number>;
  stops_by_type: KpiValue<StopsByType>;
  visited_customers: KpiValue<number>;
  /** Visits flagged successful by the seller over all visits, in %. */
  effective_visits_rate: KpiValue<number | null>;
  average_visit_minutes: KpiValue<number | null>;
  total_sales: KpiValue<Money>;
  orders_count: KpiValue<number>;
  average_ticket: KpiValue<Money | null>;
  /** total_sales divided by the calendar months the range touches. */
  average_monthly_sales: KpiValue<Money>;
  /** Sales attributed to a route divided by executed route-days (wireframe 1d). */
  route_effectiveness: KpiValue<Money | null>;
  /** Sales of the sellers with a goal over the sum of their goals, in %. */
  goal_compliance: KpiValue<number | null>;
  customers_without_visit: KpiValue<number>;
  recovered_customers: KpiValue<number>;
  new_prospects: KpiValue<number>;
  purchase_frequency_days: KpiValue<number | null>;
  /** Snapshot as of today: credit balance older than credit_term_days. */
  overdue_portfolio: KpiValue<Money>;
  /** Snapshot as of today: every outstanding credit balance. */
  pending_collections: KpiValue<Money>;
}

/**
 * Build-time guard: KPI_NAMES (the values `?kpis=` accepts) must list exactly
 * the keys of CompanyKpis. Adding a KPI to one and not the other fails here.
 */
type SameKeys<A, B> = [Exclude<A, B>, Exclude<B, A>] extends [never, never] ? true : never;
const kpiNamesMatchCompanyKpis: SameKeys<KpiName, keyof CompanyKpis> = true;
void kpiNamesMatchCompanyKpis;

export interface MetricsKpisResponse extends MetricsContext {
  previous_period: MetricsPeriod;
  /** Only the KPIs requested with `?kpis=`; all of them when it is omitted. */
  kpis: Partial<CompanyKpis>;
}

export interface SellerPerformance {
  user_id: string;
  name: string;
  active: boolean;
  stops_executed: number;
  stops_by_type: StopsByType;
  visited_customers: number;
  orders_count: number;
  total_sales: Money;
  average_ticket: Money | null;
  /** Sum of the monthly goals of the months the range touches. */
  goal_amount: Money | null;
  goal_compliance: number | null;
  /** The seller's sales linked to a visit made on a route. */
  route_sales: Money;
  /** Distinct (route assignment, local day) pairs with at least one visit. */
  executed_route_days: number;
  sales_per_route: Money | null;
  /** Dispatches this seller executed whose sale belongs to another seller. */
  dispatches_for_others: number;
  /** Customers in the routes currently assigned to the seller. */
  portfolio_customers: number;
}

export interface MetricsSellersResponse extends MetricsContext {
  sellers: SellerPerformance[];
}

export interface TrendPoint {
  /** First local day of the bucket. May precede `period.from`. */
  bucket_start: string;
  stops: number;
  orders_count: number;
  total_sales: Money;
  average_ticket: Money | null;
}

export interface MetricsTrendsResponse extends MetricsContext {
  granularity: 'week' | 'month';
  points: TrendPoint[];
}

export interface InactiveCustomer {
  customer_id: string;
  name: string;
  trade_name: string | null;
  zone: string | null;
  /** Null when the customer was never visited. */
  last_visit_at: Date | null;
  days_since_last_visit: number | null;
}

export interface MetricsSellerDetailResponse extends MetricsContext {
  seller: SellerPerformance;
  weekly_trend: TrendPoint[];
  customers_without_visit: InactiveCustomer[];
}

export interface CoverageCustomer {
  customer_id: string;
  name: string;
  trade_name: string | null;
  lat: number;
  lng: number;
  visited: boolean;
  last_visit_at: Date | null;
}

export interface MetricsCoverageResponse extends MetricsContext {
  visited: number;
  not_visited: number;
  /** Active customers left out of the map because they have no GPS pin. */
  without_location: number;
  customers: CoverageCustomer[];
}

export interface PurchaseFrequencyBucket {
  label: string;
  min_days: number;
  /** Null for the open-ended last bucket. */
  max_days: number | null;
  customers: number;
}

export interface MetricsPurchaseFrequencyResponse extends MetricsContext {
  buckets: PurchaseFrequencyBucket[];
  /** Customers who bought in the period but have no earlier purchase to compare. */
  insufficient_data: number;
  average_days: number | null;
}
