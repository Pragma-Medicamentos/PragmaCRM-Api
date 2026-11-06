import { Money } from './customer.types';
import { MetricsContext, MetricsPeriod } from './metrics.types';

/*
 * Response shapes of the per-route metrics (PCRM-178).
 *
 * Same conventions as the rest of the panel (./metrics.types.ts): snake_case
 * fields, money as a two-decimal string, rates as a percentage with one
 * decimal, and `null` for "not computable in this period" — never zero.
 *
 * A route is identified by `route_id`, the `route.id` the routes API already
 * exposes. The sale reaches it through the stop its visit executed:
 * `sale.visit_id -> visit.scheduled_visit_id -> scheduled_visit.route_user_id
 * -> route_user.route_id` (CLAUDE.md 5.4).
 */

/** A seller that works the route: assigned today, or executing stops on it. */
export interface RouteSeller {
  user_id: string;
  name: string;
}

/** A route card, and the summary block of the detail. */
export interface RouteMetrics {
  route_id: string;
  name: string;
  municipality: string | null;
  zone: string | null;
  active: boolean;
  /** Sale attributed to the route in the period, VAT included. */
  amount: Money;
  /** Same, in the previous period of equal length. */
  previous_amount: Money;
  /** Percentage change of `amount` against `previous_amount`. Null when the previous period sold nothing. */
  change_rate: number | null;
  /** Agenda customers with an executed stop over agenda customers, × 100. Null without agenda. */
  visit_coverage_rate: number | null;
  sellers: RouteSeller[];
}

export interface MetricsRoutesResponse extends MetricsContext {
  /** Previous period of equal length, the one `previous_amount` refers to. */
  previous_period: MetricsPeriod;
  /** Best attributed amount first. Routes with no activity come as zeros. */
  routes: RouteMetrics[];
  /** Attributed sale of every route in the period. */
  total_amount: Money;
}

/** A customer of the route's top list, by attributed amount. */
export interface RouteCustomerSales {
  position: number;
  customer_id: string;
  name: string;
  trade_name: string | null;
  amount: Money;
  orders_count: number;
}

/** A product of the route's top list, by attributed amount. */
export interface RouteProductSales {
  position: number;
  product_id: number;
  code: string | null;
  name: string;
  amount: Money;
  /** Units of this product in its base unit (`quantity × factor`). */
  units: string;
}

/** Attributed amount of one local weekday: 0 Sunday … 6 Saturday. */
export interface RouteWeekdaySales {
  weekday: number;
  amount: Money;
  orders_count: number;
}

/** What a seller sold on this route, credited by `sale.user_id`. */
export interface RouteSellerPerformance extends RouteSeller {
  amount: Money;
  orders_count: number;
}

/** Customers on the route's agenda in the period, and how many bought. */
export interface RoutePortfolioCoverage {
  scheduled_customers: number;
  purchasing_customers: number;
  /** `purchasing_customers / scheduled_customers × 100`. Null without agenda. */
  rate: number | null;
}

export interface MetricsRouteDetailResponse extends MetricsContext {
  previous_period: MetricsPeriod;
  route: RouteMetrics;
  portfolio_coverage: RoutePortfolioCoverage;
  top_customers: RouteCustomerSales[];
  top_products: RouteProductSales[];
  /** Seven buckets, zeros included, Sunday first. */
  sales_by_weekday: RouteWeekdaySales[];
  seller_performance: RouteSellerPerformance[];
}

/**
 * One workday of the route (PCRM-188): its agenda on one local day and what
 * came out of it. Sale is credited to the workday of the stop its visit
 * executed.
 */
export interface RouteWorkday {
  /** Agenda day, `YYYY-MM-DD`. */
  date: string;
  /** Sellers whose assignment generated the day's stops. */
  sellers: RouteSeller[];
  amount: Money;
  orders_count: number;
  planned_stops: number;
  executed_stops: number;
  /** Executed stops whose visit has at least one attributed sale. */
  stops_with_order: number;
  /** Agenda customers with an executed stop over agenda customers, × 100. Null without agenda. */
  visit_coverage_rate: number | null;
  /** `stops_with_order / executed_stops × 100`. Null when no stop was executed. */
  order_rate: number | null;
}

/** Average of the workdays before the latest one: what it is compared against. */
export interface RouteWorkdayBaseline {
  /** How many workdays the average covers. */
  workdays: number;
  amount: Money;
  /** Average orders per workday, one decimal. */
  orders_count: number;
  /** Average of the workdays that have a rate; null when none has. */
  visit_coverage_rate: number | null;
  order_rate: number | null;
}

export interface MetricsRouteWorkdaysResponse {
  route: Pick<RouteMetrics, 'route_id' | 'name' | 'active'>;
  /** ISO weekday compared, 1 Monday … 7 Sunday, like `route_user.day`. */
  day: number;
  limit: number;
  /** Newest first; the first one is the workday being compared. */
  workdays: RouteWorkday[];
  /** Null with fewer than two workdays. */
  baseline: RouteWorkdayBaseline | null;
  /** Percentage change of the latest workday's amount against `baseline.amount`. Null when there is no baseline or it sold nothing. */
  change_rate: number | null;
}
