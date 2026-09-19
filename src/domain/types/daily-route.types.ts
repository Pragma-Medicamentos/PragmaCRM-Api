import { StopType } from '../schemas/daily-route.schema';
import { GeoPoint } from './customer.types';

/**
 * Which table the stop points at.
 *
 * Not a runtime union: `scheduled_visit_target_chk` already enforces
 * `num_nonnulls(customer_id, prospect_id) = 1`, so exactly one of the two is
 * set and the value is derived in SQL rather than validated here.
 */
export type TargetKind = 'customer' | 'prospect';

/**
 * A route the seller has at least one stop on for the requested day.
 *
 * Carries `route_user_id` because the assignment, not the route, is the grain:
 * `route_user` is UQ(route_id, user_id, day), so the same route can be
 * assigned to the same seller on two different weekdays and each assignment is
 * its own row (CLAUDE.md 5.1).
 */
export interface RouteRef {
  id: string;
  route_user_id: string;
  name: string;
  municipality: string | null;
  zone: string | null;
}

/** One card of the daily-route list and one pin on its map. */
export interface DailyRouteStop {
  /**
   * `scheduled_visit.id`. Doubles as the list key and the map-pin identity,
   * which is what the `sv.id` tiebreak of the ordering protects: without it,
   * two stops sharing a sort_order and a name could swap places between
   * refetches and drag the pins with them.
   */
  id: string;
  /** Always present in the response's `routes[]`. */
  route: { id: string; name: string };
  stop_type: StopType;
  target_kind: TargetKind;
  target_id: string;
  name: string;
  trade_name: string | null;
  address: string | null;
  /** Always null when `target_kind` is 'prospect': the table has no zone. */
  zone: string | null;
  /** Always null when `target_kind` is 'prospect'. */
  municipality: string | null;
  phone: string | null;
  /**
   * Null when the target has no GPS, which is an ordinary case and not an
   * error — the customer list even has a `without_gps` filter for it. The pin
   * count therefore differs from the stop count by design, and the card
   * degrades to the zone with no distance.
   */
  location: GeoPoint | null;
  /** `route_customer.sort_order`. Null on extras and on prospects. */
  sort_order: number | null;
  /**
   * Derived, never stored: true when no live `route_customer` row ties the
   * target to this route. Prospects are extra by definition, since they have
   * no route membership at all.
   */
  is_extra: boolean;
  /** `scheduled_visit.reason` — why an ad-hoc stop was added. */
  reason: string | null;
  /**
   * `visit.started_at` of the execution linked through
   * `visit.scheduled_visit_id`, as an ISO-8601 instant. Null means pending.
   *
   * Serialised to a string in the service rather than left as a Date, so the
   * payload matches the contract on its own instead of relying on Express's
   * JSON serializer to do the conversion.
   */
  completed_at: string | null;
}

export interface DailyRoute {
  /** The day actually served, `YYYY-MM-DD`. Echoes back the resolved default. */
  date: string;
  /**
   * Empty when the seller has no stops for the day. `routes` and `stops` are
   * empty together, never one without the other.
   */
  routes: RouteRef[];
  /** Flat and already ordered. The client does not re-sort. */
  stops: DailyRouteStop[];
}
