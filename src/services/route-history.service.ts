import { Client } from '../lib/prisma';
import { RouteRef } from '../domain/types/daily-route.types';
import { RouteHistory, RouteHistoryDay } from '../domain/types/route-history.types';
import { ROUTE_HISTORY_DEFAULT_LIMIT } from '../domain/schemas/daily-route.schema';
import {
  findRouteHistoryRows,
  RouteHistoryStopRow,
} from '../repositories/route-history.repository';
import { todayInBusinessZone } from './daily-route.service';

/*
 * ============================================================================
 * 1. MAIN METHODS — called directly by the me controller:
 *
 *      GET /api/v1/me/route/history -> getRouteHistory
 * ============================================================================
 */

/**
 * PCRM-203: the seller's past days, newest first, each with how many stops
 * it had and how many were completed. Read-only: it never generates a day,
 * and the detail of one comes from GET /me/route?date=, which reads past days
 * the same way.
 *
 * Today is never part of the history, even with `before` in the future: the
 * day is still running, and it already has its own screen.
 *
 * `today` is a parameter only so tests can pin it.
 */
export const getRouteHistory = async (
  client: Client,
  sellerId: string,
  options: { before?: string; limit?: number } = {},
  today: string = todayInBusinessZone()
): Promise<RouteHistory> => {
  const limit = options.limit ?? ROUTE_HISTORY_DEFAULT_LIMIT;
  const before = options.before && options.before < today ? options.before : today;

  // One day more than the page, to know whether an older page exists.
  const rows = await findRouteHistoryRows(client, sellerId, before, limit + 1);

  const days = groupByDay(rows);
  const page = days.slice(0, limit);
  const hasMore = days.length > limit;

  return {
    days: page,
    next_before: hasMore ? page[page.length - 1].date : null,
  };
};

/*
 * ============================================================================
 * 2. OTHER METHODS — the row→DTO grouping.
 * ============================================================================
 */

/** Rows arrive newest day first and in route order, and keep both. */
const groupByDay = (rows: RouteHistoryStopRow[]): RouteHistoryDay[] => {
  const byDate = new Map<string, RouteHistoryStopRow[]>();
  for (const row of rows) {
    const dayRows = byDate.get(row.visit_date);
    if (dayRows) dayRows.push(row);
    else byDate.set(row.visit_date, [row]);
  }

  return [...byDate.entries()].map(([date, dayRows]) => {
    const skippedRows = dayRows.filter((row) => !row.completed);
    return {
      date,
      routes: toRoutes(dayRows),
      total: dayRows.length,
      completed: dayRows.length - skippedRows.length,
      skipped: skippedRows.length,
      skipped_stops: skippedRows.map((row) => ({
        id: row.id,
        name: row.name,
        stop_type: row.stop_type,
      })),
    };
  });
};

/** Same derivation as the daily route's: by assignment, in first-stop order. */
const toRoutes = (rows: RouteHistoryStopRow[]): RouteRef[] => {
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
