import { z } from 'zod';
import { booleanQueryParam, paginationQuerySchema } from './pagination.schema';

export const CUSTOMER_CATEGORIES = ['A', 'B', 'C', 'uncategorized'] as const;
export type CustomerCategory = (typeof CUSTOMER_CATEGORIES)[number];

export const customerParamsSchema = z.object({
  id: z.string().uuid('Invalid customer id'),
});
export type CustomerParams = z.infer<typeof customerParamsSchema>;

/** Filters of the customer list screen. */
export const listCustomersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).max(120).optional(),
  zone: z.string().trim().min(1).max(120).optional(),
  establishment_type: z.string().trim().min(1).max(120).optional(),
  category: z.enum(CUSTOMER_CATEGORIES).optional(),
  without_gps: booleanQueryParam.optional(),
  active: booleanQueryParam.optional(),
});
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;

/**
 * History tab of the customer profile: settled sales only.
 *
 * The module handles two things and only two, and together they partition
 * every erp_status = 2 record with no overlap and no gap:
 *
 *   sale   -> erp_status = 2 AND pending_balance = 0   (this endpoint)
 *   credit -> erp_status = 2 AND pending_balance > 0   (/credits)
 *
 * Quotes (erp_status = 1) are out of scope as of 13 Sep: they are still landed
 * in sale_staging, which does not filter by state, but no endpoint exposes
 * them. Hence no `type` parameter.
 */
export const listCustomerSalesQuerySchema = paginationQuerySchema
  .extend({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((data) => !data.from || !data.to || data.from <= data.to, {
    message: '`from` must be earlier than or equal to `to`',
    path: ['from'],
  });
export type ListCustomerSalesQuery = z.infer<
  typeof listCustomerSalesQuerySchema
>;

export const listCustomerCreditsQuerySchema = paginationQuerySchema;
export type ListCustomerCreditsQuery = z.infer<
  typeof listCustomerCreditsQuerySchema
>;

// RF-02: the administrator sets the customer's exact GPS for routing.
// WGS84 (SRID 4326), same as `customer.location`.
export const updateCustomerLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  /** Optional Places-formatted address. Omit = leave unchanged; null = clear. */
  address: z.string().trim().min(1).max(500).nullable().optional(),
  /** Optional Google Place ID. Omit = leave unchanged; null = clear. */
  place_id: z.string().trim().min(1).max(255).nullable().optional(),
});
export type UpdateCustomerLocationInput = z.infer<
  typeof updateCustomerLocationSchema
>;
