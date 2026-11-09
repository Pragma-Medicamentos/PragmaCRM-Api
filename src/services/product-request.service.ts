import { DateTime } from 'luxon';
import { Client } from '../lib/prisma';
import { CustomError } from '../domain/errors/CustomError';
import {
  CreateProductRequestInput,
  DemandedProductsQuery,
  OffCatalogDemandQuery,
} from '../domain/schemas/product-request.schema';
import {
  CreatedProductRequest,
  DemandedProduct,
  OffCatalogDemandDetailResponse,
  OffCatalogDemandResponse,
} from '../domain/types/product-request.types';
import { LocalDateRange, localToday, resolveRange } from '../lib/localDateRange';
import { ERP_TIMEZONE } from '../lib/parseErpDate';
import {
  findDemandedProducts,
  findDemandProductRequests,
  findDemandProducts,
  findDemandTotals,
} from '../repositories/productRequestDemand.repository';
import { findQuotedProductByName } from '../repositories/quotedProduct.repository';

/*
 * ============================================================================
 * 1. MAIN METHODS — called directly by ProductRequestsController, one per route:
 *
 *      POST /api/v1/product-requests            -> createProductRequest
 *      GET  /api/v1/product-requests/demand     -> getOffCatalogDemand
 *      GET  /api/v1/product-requests/demand/:id -> getOffCatalogProductDemand
 *      GET  /api/v1/product-requests/products   -> listDemandedProducts
 * ============================================================================
 */

/**
 * PCRM-65 (RF-11, HU-11 CA1): record an off-catalog product a customer asked
 * for, tied to that customer and to the visit where it came up.
 *
 * Only a confirmed stop has a visit to hang the request on, so an unconfirmed
 * one is refused with 422 instead of storing an orphan row the report could
 * not attribute.
 *
 * The product goes to `quoted_product`, reused by normalized name: the
 * PCRM-67 report counts requests per product, and a fresh row per request
 * would make every count 1.
 *
 * Must run inside a transaction: the advisory lock below is released at commit,
 * and is what stops two concurrent requests from creating the same product
 * twice (`quoted_product.name` has no unique index).
 */
export const createProductRequest = async (
  client: Client,
  sellerId: string,
  input: CreateProductRequestInput
): Promise<CreatedProductRequest> => {
  const stop = await client.scheduled_visit.findFirst({
    where: { id: input.scheduled_visit_id, deleted_at: null },
    select: { id: true, route_user: { select: { user_id: true } } },
  });
  if (!stop) throw CustomError.notFound('Scheduled visit not found');

  if (stop.route_user.user_id !== sellerId) {
    throw CustomError.forbidden('This stop is not assigned to you');
  }

  const visit = await client.visit.findFirst({
    where: { scheduled_visit_id: stop.id, deleted_at: null },
    select: { id: true, customer_id: true },
  });
  if (!visit) {
    throw CustomError.unprocessable(
      'Confirm the stop before registering an off-catalog product'
    );
  }

  const product = await findOrCreateQuotedProduct(client, input.product_name);

  const row = await client.product_request.create({
    data: {
      visit_id: visit.id,
      customer_id: visit.customer_id,
      user_id: sellerId,
      quoted_product_id: product.id,
      requested_quantity: input.requested_quantity ?? null,
    },
    select: { id: true, requested_quantity: true, requested_at: true },
  });

  return {
    id: row.id,
    visit_id: visit.id,
    customer_id: visit.customer_id,
    scheduled_visit_id: stop.id,
    quoted_product: product,
    requested_quantity:
      row.requested_quantity === null ? null : Number(row.requested_quantity),
    requested_at: row.requested_at,
  };
};

export const getOffCatalogDemand = async (
  client: Client,
  query: OffCatalogDemandQuery,
  now: Date = new Date()
): Promise<OffCatalogDemandResponse> => {
  const range = resolveDemandRange(query, now);

  const [totals, rows] = await Promise.all([
    findDemandTotals(client, range),
    findDemandProducts(client, range),
  ]);

  return {
    period: { from: range.from, to: range.to },
    totals,
    products: rows.map((row) => ({
      id: row.id,
      name: row.name,
      requests: row.requests,
      customers: row.customers,
      approx_quantity: toNumber(row.approx_quantity),
      last_requested_at: row.last_requested_at,
    })),
  };
};

export const getOffCatalogProductDemand = async (
  client: Client,
  productId: string,
  query: OffCatalogDemandQuery,
  now: Date = new Date()
): Promise<OffCatalogDemandDetailResponse> => {
  const range = resolveDemandRange(query, now);

  const [product, rows] = await Promise.all([
    client.quoted_product.findFirst({
      where: { id: productId, deleted_at: null },
      select: { id: true, name: true },
    }),
    findDemandProductRequests(client, range, productId),
  ]);
  if (!product) throw CustomError.notFound('Off-catalog product not found');

  return {
    period: { from: range.from, to: range.to },
    product,
    requests: rows.map((row) => ({
      ...row,
      requested_quantity: toNumber(row.requested_quantity),
    })),
  };
};

// The app sends the picked suggestion's exact name, which findOrCreateQuotedProduct reuses.
export const listDemandedProducts = (
  client: Client,
  query: DemandedProductsQuery
): Promise<DemandedProduct[]> =>
  findDemandedProducts(client, query.search || undefined, query.limit);

/*
 * ============================================================================
 * 2. OTHER METHODS — helpers behind createProductRequest.
 * ============================================================================
 */

/**
 * The live `quoted_product` with this name, ignoring case and accents, or a new one.
 *
 * The lock key is the normalized name, so only requests for the same product
 * wait on each other. The oldest match wins if duplicates already exist.
 */
const findOrCreateQuotedProduct = async (
  client: Client,
  name: string
): Promise<{ id: string; name: string }> => {
  await client.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended('quoted_product:' || public.normalize_name(${name}), 0))
  `;

  const existing = await findQuotedProductByName(client, name);
  if (existing) return existing;

  return client.quoted_product.create({
    data: { name },
    select: { id: true, name: true },
  });
};

export const DEFAULT_DEMAND_DAYS = 90;

// Unlike the metrics panel (current month), demand defaults to the last 90 days: it piles up slowly.
const resolveDemandRange = (query: OffCatalogDemandQuery, now: Date): LocalDateRange => {
  const to = query.to ?? localToday(now);
  const from =
    query.from ??
    (DateTime.fromISO(to, { zone: ERP_TIMEZONE })
      .minus({ days: DEFAULT_DEMAND_DAYS - 1 })
      .toISODate() as string);

  if (from > to) throw CustomError.badRequest('`from` must be earlier than or equal to `to`');

  return resolveRange(from, to, now);
};

const toNumber = (value: string | null): number | null =>
  value === null ? null : Number(value);
