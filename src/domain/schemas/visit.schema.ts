import { z } from 'zod';

/**
 * ISO 8601 with an explicit offset ("2026-09-21T14:05:00-06:00" or "...Z").
 * A timestamp without offset is rejected: the device may be offline and in any
 * timezone, and guessing one would shift the visit to another day (CLAUDE.md 5.7).
 */
const isoTimestamp = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));

/**
 * RF-06: stop confirmation sent by the mobile app.
 *
 * `captured_at` is the moment the seller tapped the button on the device, not
 * the moment the request arrives: the app can be offline and sync later, and
 * the record must keep what happened in the field.
 */
export const confirmVisitSchema = z
  .object({
    scheduled_visit_id: z.string().uuid('Invalid scheduled visit id'),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    captured_at: isoTimestamp,
    // Optional RF-07 / outcome fields, so the seller can complete the stop in
    // one request. `finished_at` is the device time the seller closed the stop.
    finished_at: isoTimestamp.optional(),
    notes: z.string().trim().min(1).max(1000).optional(),
    successful: z.boolean().optional(),
    no_order_reason: z.string().trim().min(1).max(500).optional(),
  })
  .refine((data) => !data.finished_at || data.finished_at >= data.captured_at, {
    message: '`finished_at` must be later than or equal to `captured_at`',
    path: ['finished_at'],
  });
export type ConfirmVisitInput = z.infer<typeof confirmVisitSchema>;
