import { DateTime } from 'luxon';
import { Client } from '../lib/prisma';
import { CustomError } from '../domain/errors/CustomError';
import { DailyRouteStop, RouteRef } from '../domain/types/daily-route.types';
import { WeeklyRoute, WeeklyRouteDay } from '../domain/types/weekly-route.types';
import {
  findWeeklyRouteRows,
  WeeklyRouteStopRow,
} from '../repositories/weekly-route.repository';
import { todayInBusinessZone } from './daily-route.service';

const DAYS_IN_WEEK = 7;

/*
 * ============================================================================
 * 1. MAIN METHODS — called directly by the me controller:
 *
 *      GET /api/v1/me/route/week -> getWeeklyRoute
 * ============================================================================
 */

/**
 * PCRM-170: the seller's assigned routes for the week `today` falls in,
 * Monday through Sunday, one entry per day.
 *
 * Read-only on purpose. It must never call `ensureDailyStops`: generating a
 * future day freezes its plan (PCRM-161), and the whole point of this view is
 * that a reassignment made later in the week is still visible. Days with no
 * assignment come back with empty arrays rather than being left out, so the
 * client draws "Sin ruta asignada" without guessing which weekdays exist.
 *
 * `today` is a parameter only so tests can pin the week; the controller always
 * uses the business-timezone default.
 */
export const getWeeklyRoute = async (
  client: Client,
  sellerId: string,
  today: string = todayInBusinessZone()
): Promise<WeeklyRoute> => {
  const dates = weekDatesOf(today);
  const weekStart = dates[0];
  const weekEnd = dates[DAYS_IN_WEEK - 1];

  const rows = await findWeeklyRouteRows(client, sellerId, weekStart, weekEnd);

  const days: WeeklyRouteDay[] = dates.map((date, index) => {
    const day = index + 1;
    const dayRows = rows.filter((row) => row.day === day);
    return {
      day,
      date,
      routes: toRoutes(dayRows),
      stops: dayRows.map(toStop),
    };
  });

  return { week_start: weekStart, week_end: weekEnd, today, days };
};

/*
 * ============================================================================
 * 2. OTHER METHODS — week arithmetic and the row→DTO mappers.
 * ============================================================================
 */

/**
 * The seven `YYYY-MM-DD` dates of the ISO week (Monday first) containing
 * `today`. Pure calendar arithmetic on a date with no time, so no timezone is
 * involved once `today` has been resolved in the business zone.
 */
const weekDatesOf = (today: string): string[] => {
  const date = DateTime.fromISO(today, { zone: 'utc' });
  if (!date.isValid) {
    throw CustomError.internal('Could not resolve the current business week');
  }

  const monday = date.minus({ days: date.weekday - 1 });
  return Array.from({ length: DAYS_IN_WEEK }, (_, offset) =>
    monday.plus({ days: offset }).toISODate() as string
  );
};

/**
 * Same derivation as the daily route's toRoutes: the assignments the seller
 * actually has stops on that day, keyed by `route_user_id`, in first-stop
 * order. An assignment whose route has no live members contributes nothing,
 * which keeps `routes: [] ⟺ stops: []`.
 */
const toRoutes = (rows: WeeklyRouteStopRow[]): RouteRef[] => {
  const byAssignment = new Map<string, RouteRef>();

  for (const row of rows) {
    if (byAssignment.has(row.route_user_id)) continue;

    byAssignment.set(row.route_user_id, {
      id: row.route_id,
      route_user_id: row.route_user_id,
      name: row.route_name,
      municipality: row.route_municipality,
      zone: row.route_zone,
    });
  }

  return [...byAssignment.values()];
};

const toStop = (row: WeeklyRouteStopRow): DailyRouteStop => {
  const {
    lat,
    lng,
    route_id,
    route_name,
    // Grouping keys and route metadata, not part of the stop card.
    day: _day,
    visit_date: _visitDate,
    route_user_id: _routeUserId,
    route_municipality: _routeMunicipality,
    route_zone: _routeZone,
    ...rest
  } = row;

  return {
    ...rest,
    route: { id: route_id, name: route_name },
    location: lat !== null && lng !== null ? { lat, lng } : null,
    // A plan has no execution yet.
    completed_at: null,
    notes: null,
    checkin_location: null,
    distance_meters: null,
  };
};
