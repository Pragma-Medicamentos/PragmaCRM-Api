import { Client } from '../lib/prisma';
import { CustomError } from '../domain/errors/CustomError';
import { MetricsRangeQuery } from '../domain/schemas/metrics.schema';
import {
  MetricsProductDetailResponse,
  MetricsProductsNoMovementResponse,
} from '../domain/types/productMetrics.types';
import { previousRange } from '../lib/localDateRange';
import {
  findProductDetail,
  findProductMovementCounts,
  findProductSellers,
  findProductsWithoutMovement,
} from '../repositories/productMetrics.repository';
import { buildContext } from './metrics.service';

/*
 * Product metrics (PCRM-177), on top of the ranking of PCRM-172:
 *
 *      GET /api/v1/metrics/products/no-movement -> getProductsWithoutMovement
 *      GET /api/v1/metrics/products/:id         -> getProductDetail
 *
 * Both take the same `from` / `to` the panel takes and answer the same
 * `period` + `thresholds` block, so a screen can mix them with the other
 * metrics endpoints without a second date vocabulary. The SQL lives in
 * repositories/productMetrics.repository.ts; the contract is documented in
 * docs/METRICS_API.md.
 */

/**
 * Sheet of one product: what it sold, where it ranks, who bought it and who
 * sold it. A product of the catalog that sold nothing in the period is a
 * normal answer made of zeros; only an unknown or deleted product is a 404.
 */
export const getProductDetail = async (
  client: Client,
  productId: number,
  query: MetricsRangeQuery,
  now: Date = new Date()
): Promise<MetricsProductDetailResponse> => {
  const { range, context } = buildContext(query, now);
  const previous = previousRange(range);

  const [row, sellers] = await Promise.all([
    findProductDetail(client, range, previous, productId),
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
    position: row.position,
    share_percent: row.share_percent,
    period_total_amount: row.period_total_amount,
    invoices: row.invoices,
    average_ticket: row.average_ticket,
    customers: row.customers,
    portfolio_customers: row.portfolio_customers,
    penetration_percent: row.penetration_percent,
    abc_class: row.abc_class,
    trend: {
      previous_period: { from: previous.from, to: previous.to },
      previous_amount: row.previous_amount,
      change_percent: row.change_percent,
    },
    sellers,
  };
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
