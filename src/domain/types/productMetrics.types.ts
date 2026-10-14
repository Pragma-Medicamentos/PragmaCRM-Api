import { Money } from './customer.types';
import { MetricsContext } from './metrics.types';
import { Paginated } from './pagination.types';

/**
 * Response shapes of the product metrics (PCRM-177): the detail of one
 * product, its buyers and the catalog with no movement.
 *
 * Same conventions as the rest of the panel (domain/types/metrics.types.ts):
 * snake_case, money as a two-decimal string. The exception, on purpose: a
 * product with no sales in the period reports zeros, not nulls. It is a real
 * result — nothing was sold — and the dashboard shows a product sheet either
 * way.
 */

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

export interface MetricsProductDetailResponse extends MetricsContext {
  product: ProductIdentity;
  /** Sold amount in the period, VAT included. "0.00" without sales. */
  amount: Money;
  /** Units sold in the product's base unit (`quantity × factor`). */
  units: string;
  /** `amount` over the distinct sales that include it. "0.00" without sales. */
  average_ticket: Money;
  sellers: ProductSeller[];
}

/** A customer that bought the product in the period. */
export interface ProductCustomer {
  customer_id: string;
  name: string;
  trade_name: string | null;
  amount: Money;
  /** Units in the product's base unit, 4-decimal string. */
  units: string;
  /** Distinct confirmed sales of the period that include the product. */
  invoices: number;
  /** `erp_created_at` of the latest of those sales. */
  last_purchase_at: Date;
}

export type MetricsProductCustomersResponse = MetricsContext & Paginated<ProductCustomer>;

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
