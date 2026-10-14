import { Client } from '../lib/prisma';
import { CustomError } from '../domain/errors/CustomError';
import { ROLES } from '../domain/types/auth.types';
import { ExecutedRoutesQuery } from '../domain/schemas/executed-route.schema';
import {
  ExecutedRoute,
  ExecutedRoutesHistory,
  ExecutedStop,
} from '../domain/types/executed-route.types';
import { resolveRange } from '../lib/localDateRange';
import {
  ExecutedStopRow,
  findExecutedStops,
  findPlannedStops,
} from '../repositories/executed-routes.repository';
import { GPS_RADIUS_METERS } from './visit.service';

/*
 * ============================================================================
 * HU-08: history of executed routes for the Administrador.
 *
 *      GET /api/v1/executed-routes -> getExecutedRoutes
 * ============================================================================
 */

/**
 * Executed stops in the range, grouped by (seller, local day, assignment),
 * each with its check-in GPS and note. Filters by seller when given.
 *
 * An unknown seller is a 404 rather than an empty list, so a typo in the
 * filter is not mistaken for "this seller did nothing".
 */
export const getExecutedRoutes = async (
  client: Client,
  query: ExecutedRoutesQuery,
  now: Date = new Date()
): Promise<ExecutedRoutesHistory> => {
  if (query.seller_id) {
    const seller = await client.app_user.findFirst({
      where: { id: query.seller_id, deleted_at: null, role: ROLES.SELLER },
      select: { id: true },
    });
    if (!seller) throw CustomError.notFound('Seller not found');
  }

  const range = resolveRange(query.from, query.to, now);
  const rows = await findExecutedStops(client, range, query.seller_id);

  const routeUserIds = [
    ...new Set(rows.flatMap((row) => (row.route_user_id ? [row.route_user_id] : []))),
  ];
  const planned = await findPlannedStops(client, routeUserIds, range);
  const plannedByKey = new Map(
    planned.map((row) => [`${row.route_user_id}|${row.local_date}`, row.planned])
  );

  return {
    from: range.from,
    to: range.to,
    routes: groupRoutes(rows, plannedByKey),
  };
};

/*
 * ============================================================================
 * Mappers. Rows arrive already ordered (see executedStopsSql), so grouping
 * keeps first-seen order and never re-sorts.
 * ============================================================================
 */

const groupRoutes = (
  rows: ExecutedStopRow[],
  plannedByKey: Map<string, number>
): ExecutedRoute[] => {
  const byKey = new Map<string, ExecutedRoute>();

  for (const row of rows) {
    const key = `${row.seller_id}|${row.local_date}|${row.route_user_id ?? 'none'}`;
    let route = byKey.get(key);

    if (!route) {
      route = {
        key,
        date: row.local_date,
        seller: { id: row.seller_id, name: row.seller_name },
        route:
          row.route_id && row.route_name
            ? { id: row.route_id, name: row.route_name }
            : null,
        route_user_id: row.route_user_id,
        stops_planned: row.route_user_id
          ? plannedByKey.get(`${row.route_user_id}|${row.local_date}`) ?? 0
          : 0,
        stops_executed: 0,
        stops: [],
      };
      byKey.set(key, route);
    }

    route.stops.push(toStop(row));
    route.stops_executed += 1;
  }

  return [...byKey.values()];
};

const toStop = (row: ExecutedStopRow): ExecutedStop => ({
  visit_id: row.visit_id,
  scheduled_visit_id: row.scheduled_visit_id,
  customer: {
    id: row.customer_id,
    name: row.customer_name,
    trade_name: row.customer_trade_name,
  },
  stop_type: row.stop_type,
  is_extra: row.is_extra,
  started_at: row.started_at,
  finished_at: row.finished_at,
  checkin_location:
    row.lat !== null && row.lng !== null ? { lat: row.lat, lng: row.lng } : null,
  distance_meters: row.distance_meters,
  within_radius:
    row.distance_meters !== null ? row.distance_meters <= GPS_RADIUS_METERS : null,
  successful: row.successful,
  no_order_reason: row.no_order_reason,
  notes: row.notes,
});
