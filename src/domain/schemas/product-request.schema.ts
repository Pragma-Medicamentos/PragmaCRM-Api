import { z } from 'zod';

/**
 * Trims the name and collapses inner whitespace, so "Ibuprofeno  400 mg " and
 * "Ibuprofeno 400 mg" land on the same `quoted_product` and count together in
 * the RF-11 demand report (PCRM-67).
 */
const productName = z
  .string()
  .transform((value) => value.trim().replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(2, 'product_name must have at least 2 characters')
      .max(200)
  );

/**
 * PCRM-65 (RF-11): off-catalog product a customer asked for during a visit.
 *
 * The app knows the stop, not the visit: `scheduled_visit_id` is the stop id
 * of GET /me/route, and the server resolves the visit recorded for it
 * (`visit_scheduled_visit_uq`). Customer and visit come from that visit, and
 * the seller from the JWT — never from the body.
 */
export const createProductRequestSchema = z.object({
  scheduled_visit_id: z.string().uuid('Invalid scheduled visit id'),
  product_name: productName,
  // "Cantidad aproximada" in mobile wireframe 8: optional, the seller may not
  // know it. numeric(12,3) in the database.
  requested_quantity: z.number().positive().max(999_999_999).optional(),
});
export type CreateProductRequestInput = z.infer<typeof createProductRequestSchema>;
