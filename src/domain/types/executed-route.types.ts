import { GeoPoint } from './customer.types';

/**
 * One executed stop (a `visit` row) of the history: where the seller checked
 * in and what they wrote (HU-08 CA1).
 */
export interface ExecutedStop {
  visit_id: string;
  /** Null for a visit not linked to a planned stop. */
  scheduled_visit_id: string | null;
  customer: { id: string; name: string; trade_name: string | null };
  /** `visit.visit_type`: visit | dispatch | collection. */
  stop_type: string | null;
  /** True for an admin one-off (PCRM-158) or a visit outside the plan. */
  is_extra: boolean;
  started_at: Date | null;
  finished_at: Date | null;
  /** `visit.checkin_location`. Null only on legacy rows without a reading. */
  checkin_location: GeoPoint | null;
  /** Distance from the check-in to the customer's pin, in meters. */
  distance_meters: number | null;
  /** `distance_meters <= GPS_RADIUS_METERS`; null when there is no distance. */
  within_radius: boolean | null;
  successful: boolean | null;
  no_order_reason: string | null;
  /** RF-07 visit note. */
  notes: string | null;
}

/**
 * A seller's route on one local day, as it was executed. The grain is
 * (seller, day, route assignment): visits without an assignment are grouped
 * under `route: null`.
 */
export interface ExecutedRoute {
  /** Stable key for the client: `${seller_id}|${date}|${route_user_id ?? 'none'}`. */
  key: string;
  /** Local day in the business timezone, `YYYY-MM-DD`. */
  date: string;
  seller: { id: string; name: string };
  route: { id: string; name: string } | null;
  route_user_id: string | null;
  /** Planned (non-deleted) stops of the assignment for that day. 0 when `route` is null. */
  stops_planned: number;
  stops_executed: number;
  /** Ordered by check-in time. */
  stops: ExecutedStop[];
}

export interface ExecutedRoutesHistory {
  /** The range actually served, echoing the resolved defaults. */
  from: string;
  to: string;
  /** Newest day first, then seller name, then route name. */
  routes: ExecutedRoute[];
}
