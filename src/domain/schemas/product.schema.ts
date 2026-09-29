import { z } from 'zod';
import { paginationQuerySchema } from './pagination.schema';

export const productParamsSchema = z.object({
  id: z.coerce.number().int().positive('Invalid product id'),
});
export type ProductParams = z.infer<typeof productParamsSchema>;

/** Filters of the product catalog list screen. */
export const listProductsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).max(120).optional(),
});
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
