import { z } from 'zod';
import { visitNotes } from './visit.schema';

/**
 * Stop classification (CLAUDE.md 5.2): commercial call, order delivery, or
 * collection. The business measures the three separately, which is why the
 * classification is mandatory rather than a free-text label.
 *
 * This tuple mirrors `scheduled_visit_stop_type_chk`, the CHECK added in
 * 20260919215008_daily_route_stop_type_and_visit_link.sql. Because the
 * database rejects anything else, the daily-route service can type the raw
 * column as `StopType` without a runtime guard — and deriving the union from
 * the tuple is what keeps the two from drifting apart.
 */
export const STOP_TYPES = ['visit', 'dispatch', 'collection'] as const;
export type StopType = (typeof STOP_TYPES)[number];

/**
 * Query of GET /api/v1/me/route.
 *
 * `date` is optional: the service defaults it to today in the business
 * timezone, which is not the same as the server's today. `z.iso.date()`
 * accepts only `YYYY-MM-DD`, and anything else is the 400 of the contract —
 * a loose parse would silently hand the seller another day's route.
 */
export const dailyRouteQuerySchema = z.object({
  date: z.iso.date().optional(),
});
export type DailyRouteQuery = z.infer<typeof dailyRouteQuerySchema>;

/** Path params of the /api/v1/me/route/stops/:id/* routes. */
export const stopParamsSchema = z.object({
  id: z.string().uuid('Invalid scheduled visit id'),
});
export type StopParams = z.infer<typeof stopParamsSchema>;

/**
 * Body of PATCH /api/v1/me/route/stops/:id/location (PCRM-160).
 *
 * `accuracy_meters` is required, not optional: the pin is written once and the
 * seller cannot correct it afterwards, so the server has to be able to refuse
 * a reading too coarse to validate visits against (see the service).
 */
export const setStopLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy_meters: z.number().nonnegative(),
});
export type SetStopLocationInput = z.infer<typeof setStopLocationSchema>;

/**
 * Body of PATCH /api/v1/me/route/stops/:id/note (RF-07).
 *
 * The note replaces whatever the visit had: a retry from an offline client
 * then lands on the same text instead of appending it twice.
 */
export const setStopNoteSchema = z.object({
  notes: visitNotes,
});
export type SetStopNoteInput = z.infer<typeof setStopNoteSchema>;

/** Days per page of GET /api/v1/me/route/history when `limit` is omitted. */
export const ROUTE_HISTORY_DEFAULT_LIMIT = 20;
/** Two months of working days: enough for a page, small enough to stay fast. */
export const ROUTE_HISTORY_MAX_LIMIT = 60;

/**
 * Query of GET /api/v1/me/route/history (PCRM-203).
 *
 * `before` is the keyset cursor: only days strictly before it are returned.
 * Omitted, it is today in the business timezone, so today never shows up in
 * the history. A `before` in the future is capped to today by the service
 * rather than rejected: it means "from the most recent day", nothing more.
 */
export const routeHistoryQuerySchema = z.object({
  before: z.iso.date().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(ROUTE_HISTORY_MAX_LIMIT)
    .default(ROUTE_HISTORY_DEFAULT_LIMIT),
});
export type RouteHistoryQuery = z.infer<typeof routeHistoryQuerySchema>;
