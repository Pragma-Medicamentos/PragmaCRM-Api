import { z } from 'zod';

/** Rows of each top list in the route detail (top customers, top products). */
export const ROUTE_TOP_LIMIT = 10;

/**
 * `:id` of GET /metrics/routes/:id. It is `route.id`, the same uuid the
 * routes API uses, so the dashboard can jump from a ranking row straight to
 * the route's configuration screen.
 *
 * z.guid, not z.uuid, for the reason given in metrics.schema.ts: Zod 4's
 * uuid() rejects the fixed ids of supabase/seed.sql.
 */
export const metricsRouteParamsSchema = z.object({
  id: z.guid('Invalid route id'),
});
export type MetricsRouteParams = z.infer<typeof metricsRouteParamsSchema>;

/** Workdays GET /metrics/routes/:id/workdays returns when `limit` is omitted (PCRM-188). */
export const ROUTE_WORKDAYS_DEFAULT_LIMIT = 5;
export const ROUTE_WORKDAYS_MAX_LIMIT = 12;

/**
 * Query of the workday comparison. `day` is the ISO weekday of `route_user.day`
 * (1 Monday … 7 Sunday); omitted, the service takes the day of the route's
 * latest workday. `limit` counts the latest workday too, so the minimum of 2
 * is the smallest comparison there is.
 */
export const metricsRouteWorkdaysQuerySchema = z.object({
  day: z.coerce
    .number()
    .int()
    .min(1, 'day must be between 1 and 7')
    .max(7, 'day must be between 1 and 7')
    .optional(),
  limit: z.coerce
    .number()
    .int()
    .min(2, `limit must be between 2 and ${ROUTE_WORKDAYS_MAX_LIMIT}`)
    .max(ROUTE_WORKDAYS_MAX_LIMIT, `limit must be between 2 and ${ROUTE_WORKDAYS_MAX_LIMIT}`)
    .default(ROUTE_WORKDAYS_DEFAULT_LIMIT),
});
export type MetricsRouteWorkdaysQuery = z.infer<typeof metricsRouteWorkdaysQuerySchema>;
