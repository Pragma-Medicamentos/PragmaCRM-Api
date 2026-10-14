import { Client } from '../lib/prisma';
import { LocalDateRange } from '../lib/localDateRange';
import { Money } from '../domain/types/customer.types';
import {
  ProductCustomer,
  ProductIdentity,
  ProductMovementCounts,
  ProductSeller,
  ProductWithoutMovement,
} from '../domain/types/productMetrics.types';
import {
  productCustomersSql,
  productCustomersTotalSql,
  productDetailSql,
  productSellersSql,
} from './metrics/productDetail.sql';
import {
  productMovementCountsSql,
  productsWithoutMovementSql,
} from './metrics/productNoMovement.sql';

/*
 * Data access of the product metrics (PCRM-177). The SQL text lives in
 * ./metrics/product*.sql.ts; services/productMetrics.service.ts only resolves
 * the period and shapes the rows, like the rest of the metrics module.
 */

/** The single row of the detail query: already computed, nothing to derive. */
export interface ProductDetailRow extends ProductIdentity {
  amount: Money;
  units: string;
  average_ticket: Money;
}

export interface ProductCustomersTotalRow {
  product_exists: boolean;
  total: number;
}

export interface ProductMovementCountsRow extends ProductMovementCounts {
  active_products: number;
}

/** Undefined when the product does not exist or is deleted: the service 404s. */
export const findProductDetail = async (
  client: Client,
  range: LocalDateRange,
  productId: number
): Promise<ProductDetailRow | undefined> => {
  const rows = await client.$queryRaw<ProductDetailRow[]>(productDetailSql(range, productId));
  return rows[0];
};

/** Sellers that moved the product in the range, by amount, best first. */
export const findProductSellers = (
  client: Client,
  range: LocalDateRange,
  productId: number
): Promise<ProductSeller[]> =>
  client.$queryRaw<ProductSeller[]>(productSellersSql(range, productId));

/** One page of the product's buyers in the range, by amount, best first. */
export const findProductCustomers = (
  client: Client,
  range: LocalDateRange,
  productId: number,
  limit: number,
  offset: number
): Promise<ProductCustomer[]> =>
  client.$queryRaw<ProductCustomer[]>(productCustomersSql(range, productId, limit, offset));

/** Always exactly one row. */
export const findProductCustomersTotal = async (
  client: Client,
  range: LocalDateRange,
  productId: number
): Promise<ProductCustomersTotalRow | undefined> => {
  const rows = await client.$queryRaw<ProductCustomersTotalRow[]>(
    productCustomersTotalSql(range, productId)
  );
  return rows[0];
};

/** Active products with no confirmed sale inside the range. */
export const findProductsWithoutMovement = (
  client: Client,
  range: LocalDateRange
): Promise<ProductWithoutMovement[]> =>
  client.$queryRaw<ProductWithoutMovement[]>(productsWithoutMovementSql(range));

/** Catalog size and the 30/60/90-day counts. Always exactly one row. */
export const findProductMovementCounts = async (
  client: Client,
  range: LocalDateRange
): Promise<ProductMovementCountsRow | undefined> => {
  const rows = await client.$queryRaw<ProductMovementCountsRow[]>(
    productMovementCountsSql(range)
  );
  return rows[0];
};
