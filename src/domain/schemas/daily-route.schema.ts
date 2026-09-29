import { z } from 'zod';

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
