import { z } from 'zod';
import { paginationQuerySchema } from './pagination.schema';

/**
 * ISO 8601 with an explicit offset ("2026-09-21T14:05:00-06:00" or "...Z").
 * A timestamp without offset is rejected: the device may be offline and in any
 * timezone, and guessing one would shift the prospect to another day (CLAUDE.md 5.7).
 */
const isoTimestamp = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));

/**
 * PCRM-62: prospect registration from the seller mobile app.
 *
 * `captured_at` is the moment the seller detected the prospect on the device,
 * not the moment the request arrives (offline sync). There is no `captured_at`
 * column on `prospect`; the API echoes it in the 201 body while `created_at`
 * stays the server clock.
 *
 * `user_id` (seller) must come from the JWT — never from the body.
 */
export const createProspectSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(200),
  phone: z.string().trim().min(1, 'phone is required').max(40),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  captured_at: isoTimestamp,
});
export type CreateProspectInput = z.infer<typeof createProspectSchema>;


/** PCRM-62 / PCRM-64: admin list of prospects. */
export const listProspectsQuerySchema = paginationQuerySchema.extend({
  user_id: z.string().uuid('Invalid user id').optional(),
});
export type ListProspectsQuery = z.infer<typeof listProspectsQuerySchema>;
