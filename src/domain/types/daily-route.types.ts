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
   * RF-12 communication style as a lowercase colour (`rojo`, `amarillo`,
   * `verde`, `azul`). Free text in the database, so the client normalises it.
   * Always null when `target_kind` is 'prospect': the table has no such column.
   */
  personality: string | null;
  /** RF-12 buying potential (`alto`, `medio`, `bajo`). Null for prospects. */
  potential: string | null;
  /** Null for prospects. */
  establishment_type: string | null;
  /**
   * `customer.credit_limit`, numeric(14,2) cast to a JS number: two decimals
   * of a currency amount fit a double exactly. Null for prospects.
   */
  credit_limit: number | null;
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
   * `visit.scheduled_visit_id`. Null means pending.
   *
   * A Date, not a pre-stringified instant: Express serialises it to the same
   * ISO 8601 the contract shows, so the wire payload is identical, and every
   * other date field in the domain types is a Date. Stringifying here would
   * only cost the next consumer a reparse.
   */
  completed_at: Date | null;
}

export interface DailyRoute {
  /**
   * The day actually served, `YYYY-MM-DD`. Echoes back the resolved default.
   *
   * A string and not a Date, unlike `completed_at`: this is a calendar day in
   * the business timezone, not an instant. A Date would force a timezone onto
   * it and reintroduce exactly the off-by-one-day the default guards against.
   */
  date: string;
  /**
   * Empty when the seller has no stops for the day. `routes` and `stops` are
   * empty together, never one without the other.
   */
  routes: RouteRef[];
  /** Flat and already ordered. The client does not re-sort. */
  stops: DailyRouteStop[];
}

/**
 * Result of PATCH /api/v1/me/route/stops/:id/location: the pin the seller just
 * fixed on the stop's customer.
 */
export interface StopCustomerLocation {
  customer_id: string;
  location: GeoPoint;
}
