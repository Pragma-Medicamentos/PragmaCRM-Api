import { DailyRouteStop, RouteRef } from './daily-route.types';

/** One weekday of the seller's assigned week. */
export interface WeeklyRouteDay {
  /** ISO weekday, 1 = Monday … 7 = Sunday (same as `route_user.day`). */
  day: number;
  /** `YYYY-MM-DD`, a calendar day in the business timezone. */
  date: string;
  /** Empty together with `stops`, never one without the other. */
  routes: RouteRef[];
  /**
   * Same shape as the daily route's stops so the app reuses its map and
   * sheet. Planned stops carry `route_customer.id` as `id`; extras carry
   * `scheduled_visit.id`. `completed_at` and `notes` are always null: this is
   * the plan, not its execution.
   */
  stops: DailyRouteStop[];
}

/**
 * PCRM-170: the seller's live weekly assignment for the current week. Not a
 * history — it is read from `route_user` + `route_customer` every time, so a
 * reassignment is visible on the next request.
 */
export interface WeeklyRoute {
  /** Monday of the week, `YYYY-MM-DD`. */
  week_start: string;
  /** Sunday of the week, `YYYY-MM-DD`. */
  week_end: string;
  /** Today in the business timezone, so the client never uses its own clock. */
  today: string;
  /** Always seven entries, Monday first, including days with no route. */
  days: WeeklyRouteDay[];
}
