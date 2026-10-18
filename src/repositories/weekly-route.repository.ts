import { Client } from '../lib/prisma';
import { StopType } from '../domain/schemas/daily-route.schema';
import { TargetKind } from '../domain/types/daily-route.types';
import { weeklyRouteSql } from './weekly-route/weekly-route.sql';

/**
 * Row of weeklyRouteSql: one per stop of the week. Same columns as the daily
 * route's row, minus the execution (`completed_at`, `notes` — nothing in a
 * template has been executed), plus the weekday it falls on.
 */
export interface WeeklyRouteStopRow {
  id: string;
  /** ISO weekday, 1 = Monday … 7 = Sunday. */
  day: number;
  /** `YYYY-MM-DD` of that weekday inside the requested week. */
  visit_date: string;
  route_user_id: string;
  route_id: string;
  route_name: string;
  route_municipality: string | null;
  route_zone: string | null;
  stop_type: StopType;
  target_kind: TargetKind;
  target_id: string;
  name: string;
  trade_name: string | null;
  address: string | null;
  zone: string | null;
  municipality: string | null;
  phone: string | null;
  personality: string | null;
  potential: string | null;
  establishment_type: string | null;
  credit_limit: number | null;
  lat: number | null;
  lng: number | null;
  sort_order: number | null;
  is_extra: boolean;
  reason: string | null;
}

/** Already ordered by day, planned before extras, then sort_order and name. */
export const findWeeklyRouteRows = (
  client: Client,
  sellerId: string,
  weekStart: string,
  weekEnd: string
): Promise<WeeklyRouteStopRow[]> =>
  client.$queryRaw<WeeklyRouteStopRow[]>(weeklyRouteSql(sellerId, weekStart, weekEnd));
