import { z } from 'zod';
import { booleanQueryParam, paginationQuerySchema } from './pagination.schema';
import { fiscalFields } from './fiscal.schema';

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
  ...fiscalFields,
});
export type CreateProspectInput = z.infer<typeof createProspectSchema>;

/** PCRM-64: admin list of prospects. */
export const listProspectsQuerySchema = paginationQuerySchema.extend({
  user_id: z.string().uuid('Invalid user id').optional(),
  /** PCRM-186: `false` lists the converted ones, `true` the ones still open. */
  active: booleanQueryParam.optional(),
});
export type ListProspectsQuery = z.infer<typeof listProspectsQuerySchema>;

export const prospectParamsSchema = z.object({
  id: z.string().uuid('Invalid prospect id'),
});
export type ProspectParams = z.infer<typeof prospectParamsSchema>;

/**
 * PCRM-64: admin registers a prospect on behalf of a seller (a phone lead, a
 * walk-in at the office, etc.) — unlike the mobile flow, the admin isn't
 * standing at the location, so GPS is optional here; `PATCH
 * /:id/location` (updateProspectLocationSchema) fills it in later.
 */
export const createProspectAdminSchema = z
  .object({
    user_id: z.string().uuid('Invalid seller id'),
    name: z.string().trim().min(1, 'name is required').max(200),
    phone: z.string().trim().min(1, 'phone is required').max(40),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    ...fiscalFields,
  })
  .refine(
    (data) => (data.latitude === undefined) === (data.longitude === undefined),
    {
      message: 'latitude and longitude must be provided together',
      path: ['latitude'],
    }
  );
export type CreateProspectAdminInput = z.infer<typeof createProspectAdminSchema>;

/** PCRM-64: set a prospect's GPS pin after the fact (see createProspectAdminSchema). */
export const updateProspectLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type UpdateProspectLocationInput = z.infer<
  typeof updateProspectLocationSchema
>;

/**
 * PCRM-185: admin edits a prospect's identity and fiscal data. Partial: an
 * omitted field is left as is, null clears an optional one. `name` and
 * `phone` stay mandatory on the row, so they accept a value but never null.
 * Strict, so a typo or a field this endpoint does not own (location, user_id)
 * answers 400 instead of being dropped silently.
 */
export const updateProspectSchema = z
  .object({
    name: z.string().trim().min(1, 'name cannot be empty').max(200).optional(),
    phone: z
      .string()
      .trim()
      .min(1, 'phone cannot be empty')
      .max(40)
      .optional(),
    ...fiscalFields,
  })
  .strict()
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'At least one field is required',
  });
export type UpdateProspectInput = z.infer<typeof updateProspectSchema>;
