import { Money } from './customer.types';
import { MetricsContext, MetricsPeriod } from './metrics.types';
import { Paginated } from './pagination.types';
import { SalesGroupBy } from '../schemas/salesComparison.schema';

/** The three sales figures of one period. Confirmed sales only (erp_status = 2). */
export interface SalesFigures {
  total_sales: Money;
  orders_count: number;
  /** Null when the period has no sales: there is nothing to average. */
  average_ticket: Money | null;
}

/**
 * Change from the previous period to the selected one. `pct` is null when the
 * previous value is 0 or missing: there is no base to divide by, and the web
 * shows that case as "new" instead of an infinite percentage.
 */
export interface MoneyChange {
  amount: Money | null;
  pct: number | null;
}

export interface CountChange {
  amount: number;
  pct: number | null;
}

export interface SalesVariation {
  total_sales: MoneyChange;
  orders_count: CountChange;
  average_ticket: MoneyChange;
}

export interface SalesComparison {
  current: SalesFigures;
  previous: SalesFigures;
  variation: SalesVariation;
}

/**
 * One row of the breakdown. `id` and `name` are null for the sales that have
 * no customer or no seller (an `id_usuario` from Efactsoft that maps to no
 * app_user): they are grouped in one row so the rows add up to the totals.
 */
export interface SalesComparisonRow extends SalesComparison {
  id: string | null;
  name: string | null;
}

export interface SalesComparisonBreakdown extends Paginated<SalesComparisonRow> {
  group_by: SalesGroupBy;
}

export interface SalesComparisonResponse extends MetricsContext {
  previous_period: MetricsPeriod;
  filters: { customer_id: string | null; user_id: string | null };
  totals: SalesComparison;
  /** Null without `group_by`. */
  breakdown: SalesComparisonBreakdown | null;
}
