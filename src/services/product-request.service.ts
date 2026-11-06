import { Client } from '../lib/prisma';
import { CustomError } from '../domain/errors/CustomError';
import { CreateProductRequestInput } from '../domain/schemas/product-request.schema';
import { CreatedProductRequest } from '../domain/types/product-request.types';

/*
 * ============================================================================
 * 1. MAIN METHODS — called directly by ProductRequestsController, one per route:
 *
 *      POST /api/v1/product-requests -> createProductRequest
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
 * The product goes to `quoted_product`, reused by case-insensitive name: the
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

/*
 * ============================================================================
 * 2. OTHER METHODS — helpers behind createProductRequest.
 * ============================================================================
 */

/**
 * The live `quoted_product` with this name, ignoring case, or a new one.
 *
 * The lock key is the lower-cased name, so only requests for the same product
 * wait on each other. The oldest match wins if duplicates already exist.
 */
const findOrCreateQuotedProduct = async (
  client: Client,
  name: string
): Promise<{ id: string; name: string }> => {
  await client.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${`quoted_product:${name.toLowerCase()}`}, 0))
  `;

  const existing = await client.quoted_product.findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, deleted_at: null },
    select: { id: true, name: true },
    orderBy: { created_at: 'asc' },
  });
  if (existing) return existing;

  return client.quoted_product.create({
    data: { name },
    select: { id: true, name: true },
  });
};
