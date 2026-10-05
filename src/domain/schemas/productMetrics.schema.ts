import { z } from 'zod';

/**
 * `:id` of GET /metrics/products/:id. It is `product.erp_product_id`, the
 * ERP's natural integer key, not a uuid: the catalog mirrors Efactsoft
 * (CLAUDE.md 6.4). Anything that is not a positive integer is a 400, which is
 * also what keeps a stray path segment from reaching the service.
 */
export const metricsProductParamsSchema = z.object({
  id: z.coerce.number().int('Invalid product id').positive('Invalid product id'),
});
export type MetricsProductParams = z.infer<typeof metricsProductParamsSchema>;
