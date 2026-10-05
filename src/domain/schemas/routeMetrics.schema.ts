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
