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
 * exposes. The sale reaches it through `sale.visit_id -> visit.route_user_id
 * -> route_user.route_id` (CLAUDE.md 5.4).
 */

/** A seller that works the route: assigned today, or executing stops on it. */
export interface RouteSeller {
  user_id: string;
  name: string;
}

/** A row of the route ranking, and the summary block of the detail. */
export interface RouteMetrics {
  route_id: string;
  name: string;
  municipality: string | null;
  zone: string | null;
  active: boolean;
  /** Sale attributed to the route in the period, VAT included. */
  amount: Money;
  /** Units sold in each product's base unit (`quantity × factor`). */
  units: string;
  /** 1-based rank by `amount` DESC among every route; ties broken by name. */
  amount_position: number;
  /** 1-based rank by `units` DESC among every route; ties broken by name. */
  units_position: number;
  /** Distinct (assignment, local day) pairs with at least one visit. */
  executed_route_days: number;
  /** `amount / executed_route_days`. Null when the route was never executed. */
  effectiveness: Money | null;
  visited_customers: number;
  /** Customers on the route's agenda in the period (prospect stops excluded). */
  planned_customers: number;
  /** `visited_customers / planned_customers × 100`. Null without agenda. */
  visit_coverage_rate: number | null;
  stops_executed: number;
  stops_planned: number;
  sellers: RouteSeller[];
}

export interface MetricsRoutesResponse extends MetricsContext {
  routes: RouteMetrics[];
  /** Attributed sale of every route in the period, before any filter. */
  total_amount: Money;
  total_units: string;
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
  units: string;
  orders_count: number;
}

/** Customers that make up the route today, and how many bought. */
export interface RoutePortfolioCoverage {
  assigned_customers: number;
  purchasing_customers: number;
  /** `purchasing_customers / assigned_customers × 100`. Null without portfolio. */
  rate: number | null;
}

/** Attributed amount against the previous period of equal length. */
export interface RouteSalesTrend {
  period: MetricsPeriod;
  amount: Money;
  /** Percentage change against `amount`. Null when the previous period sold nothing. */
  change_rate: number | null;
}

/**
 * Average ticket of one route (PCRM-176). It is its own response and not a
 * field of the ranking or of the detail: those answer "how much did the
 * route sell", this one "how big is an order of this route".
 */
export interface MetricsRouteTicketResponse {
  route_id: string;
  period: MetricsPeriod;
  /** Sale attributed to the route in the period, VAT included. */
  amount: Money;
  /** Distinct confirmed invoices behind `amount`. */
  invoices: number;
  /** `amount / invoices`. Null without invoices: never a division by zero. */
  average_ticket: Money | null;
}

export interface MetricsRouteDetailResponse extends MetricsContext {
  route: RouteMetrics;
  previous: RouteSalesTrend;
  portfolio_coverage: RoutePortfolioCoverage;
  top_customers: RouteCustomerSales[];
  top_products: RouteProductSales[];
  /** Seven buckets, zeros included, Sunday first. */
  sales_by_weekday: RouteWeekdaySales[];
  seller_performance: RouteSellerPerformance[];
}
