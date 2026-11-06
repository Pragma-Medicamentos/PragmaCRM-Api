import { StopType } from '../schemas/daily-route.schema';
import { RouteRef } from './daily-route.types';

/** A stop of a past day that was never marked (no linked `visit`). */
export interface SkippedStop {
  /** `scheduled_visit.id`, the same id GET /me/route?date= returns. */
  id: string;
  name: string;
  stop_type: StopType;
}

/** One past day of the seller, summarised for the history list. */
export interface RouteHistoryDay {
  /** `YYYY-MM-DD`, a calendar day in the business timezone. */
  date: string;
  /** The assignments the seller had stops on that day, never empty. */
  routes: RouteRef[];
  /** Stops planned for the day, extras and prospects included. */
  total: number;
  /** Stops with a linked visit. */
  completed: number;
  /**
   * `total - completed`. The app has no "omitir parada" flow yet (wireframe
   * 7), so a skipped stop is simply one nobody marked, and there is no reason
   * to show: `visit.no_order_reason` lives on a visit, and a skipped stop has
   * none.
   */
  skipped: number;
  /** The skipped stops themselves, in route order. */
  skipped_stops: SkippedStop[];
}

/** Result of GET /api/v1/me/route/history (PCRM-203). */
export interface RouteHistory {
  /** Newest day first. Days without stops are left out. */
  days: RouteHistoryDay[];
  /**
   * The `before` of the next page: the date of the last day returned. Null
   * when there are no older days.
   */
  next_before: string | null;
}
