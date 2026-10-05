import { Money } from './customer.types';
import { MetricsContext, MetricsPeriod } from './metrics.types';

/**
 * Response shapes of the product metrics (PCRM-177): the detail of one
 * product and the catalog with no movement.
 *
 * Same conventions as the rest of the panel (domain/types/metrics.types.ts):
 * snake_case, money as a two-decimal string, rates as a percentage with one
 * decimal. The exception, on purpose: a product with no sales in the period
 * reports zeros, not nulls. It is a real result — nothing was sold — and the
 * dashboard shows a product sheet either way. Only `position`, `abc_class`
 * and `trend.change_percent` are null, because they genuinely do not exist.
 */

/** Pareto class by the period's sold amount. Cuts in constants/productMetrics.ts. */
export type AbcClass = 'A' | 'B' | 'C';

/** The catalog row, repeated wherever a product is named. */
export interface ProductIdentity {
  /** `product.erp_product_id`, the ERP's natural key. */
  product_id: number;
  code: string | null;
  name: string;
  product_group: string | null;
}

/** A seller that moved the product in the period. */
export interface ProductSeller {
  user_id: string;
  name: string;
  amount: Money;
  /** Units in the product's base unit, 4-decimal string. */
  units: string;
}

export interface ProductTrend {
  previous_period: MetricsPeriod;
  previous_amount: Money;
  /** Percent change of `amount`; null when the previous period sold nothing. */
  change_percent: number | null;
}

export interface MetricsProductDetailResponse extends MetricsContext {
  product: ProductIdentity;
  /** Sold amount in the period, VAT included. "0.00" without sales. */
  amount: Money;
  /** Units sold in the product's base unit (`quantity × factor`). */
  units: string;
  /** Rank in the period's ranking; null when the product did not sell. */
  position: number | null;
  /** `amount` over the period's total product sales, in %. 0 without sales. */
  share_percent: number;
  /** Amount of every product with sales in the period: the ranking's total. */
  period_total_amount: Money;
  /** Distinct confirmed sales that include the product. Its frequency. */
  invoices: number;
  /** `amount / invoices`. "0.00" when there are no invoices. */
  average_ticket: Money;
  /** Distinct customers that bought the product in the period. */
  customers: number;
  /** Customers with at least one confirmed sale in the period, company-wide. */
  portfolio_customers: number;
  /** `customers / portfolio_customers`, in %. 0 when nobody bought. */
  penetration_percent: number;
  /** Null when the product did not sell in the period. */
  abc_class: AbcClass | null;
  trend: ProductTrend;
  sellers: ProductSeller[];
}

export interface ProductWithoutMovement extends ProductIdentity {
  /** Last confirmed sale before the end of the period; null if it never sold. */
  last_sold_at: Date | null;
  /** Days from that sale to the end of the period; null if it never sold. */
  days_since_last_sale: number | null;
}

/** Active products with no confirmed sale in the last N days ending at `to`. */
export interface ProductMovementCounts {
  days_30: number;
  days_60: number;
  days_90: number;
}

export interface MetricsProductsNoMovementResponse extends MetricsContext {
  /** Catalog size the counts are read against (`product.deleted_at IS NULL`). */
  active_products: number;
  /** Active products with no confirmed sale inside `period`. */
  products: ProductWithoutMovement[];
  without_movement: ProductMovementCounts;
}
