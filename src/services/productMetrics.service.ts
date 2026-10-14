import { Client } from '../lib/prisma';
import { CustomError } from '../domain/errors/CustomError';
import {
  MetricsProductCustomersQuery,
  MetricsRangeQuery,
} from '../domain/schemas/metrics.schema';
import { buildPage } from '../domain/types/pagination.types';
import {
  MetricsProductCustomersResponse,
  MetricsProductDetailResponse,
  MetricsProductsNoMovementResponse,
} from '../domain/types/productMetrics.types';
import {
  findProductCustomers,
  findProductCustomersTotal,
  findProductDetail,
  findProductMovementCounts,
  findProductSellers,
  findProductsWithoutMovement,
} from '../repositories/productMetrics.repository';
import { buildContext } from './metrics.service';

/*
 * Product metrics (PCRM-177), on top of the ranking of PCRM-172:
 *
 *      GET /api/v1/metrics/products/no-movement   -> getProductsWithoutMovement
 *      GET /api/v1/metrics/products/:id           -> getProductDetail
 *      GET /api/v1/metrics/products/:id/customers -> getProductCustomers
 *
 * All take the same `from` / `to` the panel takes and answer the same
 * `period` + `thresholds` block, so a screen can mix them with the other
 * metrics endpoints without a second date vocabulary. The SQL lives in
 * repositories/productMetrics.repository.ts; the contract is documented in
 * docs/METRICS_API.md.
 */

/**
 * Sheet of one product: what it sold and who sold it. A product of the
 * catalog that sold nothing in the period is a normal answer made of zeros;
 * only an unknown or deleted product is a 404.
 */
export const getProductDetail = async (
  client: Client,
  productId: number,
  query: MetricsRangeQuery,
  now: Date = new Date()
): Promise<MetricsProductDetailResponse> => {
  const { range, context } = buildContext(query, now);

  const [row, sellers] = await Promise.all([
    findProductDetail(client, range, productId),
    findProductSellers(client, range, productId),
  ]);

  if (!row) {
    throw CustomError.notFound(`Product ${productId} not found`);
  }

  return {
    ...context,
    product: {
      product_id: row.product_id,
      code: row.code,
      name: row.name,
      product_group: row.product_group,
    },
    amount: row.amount,
    units: row.units,
    average_ticket: row.average_ticket,
    sellers,
  };
};

/** Customers who bought the product in the period, biggest buyer first, one page at a time. */
export const getProductCustomers = async (
  client: Client,
  productId: number,
  query: MetricsProductCustomersQuery,
  now: Date = new Date()
): Promise<MetricsProductCustomersResponse> => {
  const { range, context } = buildContext(query, now);
  const offset = (query.page - 1) * query.limit;

  const [totals, items] = await Promise.all([
    findProductCustomersTotal(client, range, productId),
    findProductCustomers(client, range, productId, query.limit, offset),
  ]);

  if (!totals?.product_exists) {
    throw CustomError.notFound(`Product ${productId} not found`);
  }

  return { ...context, ...buildPage(items, totals.total, query.page, query.limit) };
};

/**
 * Active products that did not sell in the period, plus how many have been
 * quiet for 30, 60 and 90 days counted back from `to`. The list follows the
 * selected range; the three counts never do, so a weekly range still reports
 * the quarter.
 */
export const getProductsWithoutMovement = async (
  client: Client,
  query: MetricsRangeQuery,
  now: Date = new Date()
): Promise<MetricsProductsNoMovementResponse> => {
  const { range, context } = buildContext(query, now);

  const [products, counts] = await Promise.all([
    findProductsWithoutMovement(client, range),
    findProductMovementCounts(client, range),
  ]);

  return {
    ...context,
    active_products: counts?.active_products ?? 0,
    products,
    without_movement: {
      days_30: counts?.days_30 ?? 0,
      days_60: counts?.days_60 ?? 0,
      days_90: counts?.days_90 ?? 0,
    },
  };
};
