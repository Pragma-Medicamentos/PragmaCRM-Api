/** Visit as returned by the stop confirmation endpoint (RF-06). */
export interface ConfirmedVisit {
  id: string;
  scheduled_visit_id: string;
  /** Exactly one of customer_id / prospect_id is set (visit_target_chk). */
  customer_id: string | null;
  prospect_id: string | null;
  visit_type: string;
  /** Device time of the check-in, as sent by the client. */
  started_at: Date;
  finished_at: Date | null;
  location: { lat: number; lng: number };
  /** Server-computed distance to the customer's or prospect's pin, in meters. */
  distance_meters: number;
  /** Derived from distance_meters, never stored: see CLAUDE.md 5.3. */
  within_radius: boolean;
  radius_meters: number;
  successful: boolean | null;
  no_order_reason: string | null;
  notes: string | null;
  /** True when this request repeated an already confirmed stop (offline retry). */
  replayed: boolean;
}
