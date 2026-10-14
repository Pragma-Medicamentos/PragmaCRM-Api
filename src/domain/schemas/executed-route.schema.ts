import { z } from 'zod';

/**
 * Longest range the executed-routes history accepts. Unlike the metrics panel
 * (aggregates, up to a year) this endpoint returns one row per executed stop,
 * so the window is kept to roughly a quarter to bound the payload.
 */
export const EXECUTED_ROUTES_MAX_RANGE_DAYS = 92;

const MS_PER_DAY = 86_400_000;

/** A local calendar day, `YYYY-MM-DD` (CLAUDE.md 5.7). */
const localDay = z.iso.date('Expected a date in YYYY-MM-DD format');

/**
 * Query of GET /api/v1/executed-routes (HU-08).
 *
 * Every filter is optional: `from`/`to` default to the current month in the
 * business timezone, and no `seller_id` means every seller. z.guid rather than
 * z.uuid for the reason given in metrics.schema.ts (seed ids).
 */
export const executedRoutesQuerySchema = z
  .object({
    from: localDay.optional(),
    to: localDay.optional(),
    seller_id: z.guid('Invalid seller id').optional(),
  })
  // ISO dates compare correctly as strings.
  .refine((data) => !data.from || !data.to || data.from <= data.to, {
    message: '`from` must be earlier than or equal to `to`',
    path: ['from'],
  })
  .refine(
    (data) =>
      !data.from ||
      !data.to ||
      (Date.parse(data.to) - Date.parse(data.from)) / MS_PER_DAY + 1 <=
        EXECUTED_ROUTES_MAX_RANGE_DAYS,
    {
      message: `The range cannot exceed ${EXECUTED_ROUTES_MAX_RANGE_DAYS} days`,
      path: ['to'],
    }
  );
export type ExecutedRoutesQuery = z.infer<typeof executedRoutesQuerySchema>;
