import { DateTime } from 'luxon';
import { Prisma } from '../generated/prisma/client';
import { Client } from '../lib/prisma';
import { CustomError } from '../domain/errors/CustomError';
import { StopType } from '../domain/schemas/daily-route.schema';
import {
  DailyRoute,
  DailyRouteStop,
  RouteRef,
  TargetKind,
} from '../domain/types/daily-route.types';

// --- Business constants -----------------------------------------------------
//
// Fixed business rules, not environment configuration: they belong here rather
// than in envs.ts, per CLAUDE.md 5.8.

/**
 * Business timezone (CLAUDE.md 5.7). UTC−6, no daylight saving.
 *
 * The default `?date` is *today in El Salvador*, never the server's today. A
 * container running in UTC would compute 2026-09-20 at 00:30 while the seller
 * is still living 2026-09-19, and would hand him an empty route at the worst
 * possible moment. A deployment that "configured" another timezone would be a
 * bug, not a setup, which is why this is a constant and not an env var.
 */
const BUSINESS_TIME_ZONE = 'America/El_Salvador';

/**
 * Sort key given to a stop with no `route_customer.sort_order` — extras and
 * prospects. It is smallint's maximum, so those stops land after every planned
 * one without needing a second ORDER BY branch.
 *
 * Part of the endpoint contract and covered by a test: the ordering is a
 * promise to the client, which does not re-sort.
 */
const UNPLANNED_SORT_ORDER = 32767;

/*
 * ============================================================================
 * 1. MAIN METHODS — called directly by the me controller:
 *
 *      GET /api/v1/me/route -> getDailyRoute
 * ============================================================================
 */

/**
 * The seller's route for one day: the assignments it runs over, plus every
 * planned stop, flat and already ordered.
 *
 * One raw query, not three. `customer.location` and `prospect.location` are
 * Unsupported("geography") in Prisma and cannot appear in a typed select, so
 * the read has to be raw anyway; splitting it would also make the
 * `routes` ⟺ `stops` invariant something to remember instead of something the
 * shape guarantees.
 *
 * Returns an empty route rather than throwing when the seller has nothing
 * today: "no tengo ruta hoy" is a legitimate 200, and a 404 would light up the
 * app's error screen.
 */
export const getDailyRoute = async (
  client: Client,
  userId: string,
  date?: string
): Promise<DailyRoute> => {
  const visitDate = date ?? todayInBusinessZone();

  const rows = await client.$queryRaw<DailyRouteStopRow[]>(
    dailyRouteSql(userId, visitDate)
  );

  return {
    date: visitDate,
    routes: toRoutes(rows),
    stops: rows.map(toStop),
  };
};

/*
 * ============================================================================
 * 2. OTHER METHODS — the date default and the row→DTO mappers. Private: the
 *    endpoint is the only consumer, and the mappers only make sense against
 *    the row shape produced by section 3.
 * ============================================================================
 */

/** Today in the business timezone, as `YYYY-MM-DD`. See BUSINESS_TIME_ZONE. */
const todayInBusinessZone = (): string => {
  const today = DateTime.now().setZone(BUSINESS_TIME_ZONE).toISODate();

  // setZone with a hardcoded, valid IANA name cannot yield an invalid
  // DateTime; the null branch exists only because toISODate() is typed for the
  // invalid case. Failing loudly beats silently serving another day's route.
  if (!today) {
    throw CustomError.internal('Could not resolve the current business date');
  }

  return today;
};

/**
 * The routes the seller actually has stops on, derived from the same rows
 * instead of from a second query over `route_user`.
 *
 * Deriving them is what makes the contract's `routes: [] ⟺ stops: []`
 * invariant structural: a seller assigned to a route with no stops scheduled
 * for the day is not on that route today, and every `stops[].route.id`
 * necessarily appears here.
 *
 * Keyed by `route_user_id` rather than by route id, because the assignment is
 * the grain — `route_user` is UQ(route_id, user_id, day).
 */
const toRoutes = (rows: DailyRouteStopRow[]): RouteRef[] => {
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

const toStop = (row: DailyRouteStopRow): DailyRouteStop => {
  const {
    lat,
    lng,
    completed_at,
    route_id,
    route_name,
    // Route metadata that belongs to `routes[]`, not to the stop card.
    route_user_id: _routeUserId,
    route_municipality: _routeMunicipality,
    route_zone: _routeZone,
    ...rest
  } = row;

  return {
    ...rest,
    route: { id: route_id, name: route_name },
    location: lat !== null && lng !== null ? { lat, lng } : null,
    completed_at: completed_at === null ? null : completed_at.toISOString(),
  };
};

/*
 * ============================================================================
 * 3. RAW SQL — every $queryRaw template this service runs, grouped here so the
 *    queries are auditable in one place instead of scattered inside the
 *    methods that call them.
 * ============================================================================
 */

/**
 * Row of dailyRouteSql. One per stop; the route columns repeat across the
 * stops of the same assignment and are folded back into `routes[]` by
 * toRoutes.
 *
 * `stop_type` and `target_kind` are typed as their unions even though Postgres
 * hands back plain text: `scheduled_visit_stop_type_chk` and
 * `scheduled_visit_target_chk` make any other value unrepresentable, so a
 * runtime guard here would be dead code.
 */
interface DailyRouteStopRow {
  id: string;
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
  lat: number | null;
  lng: number | null;
  sort_order: number | null;
  is_extra: boolean;
  reason: string | null;
  completed_at: Date | null;
}

/**
 * SQL for getDailyRoute: the seller's planned stops for one day.
 *
 * Driven from `route_user`, not from `scheduled_visit`. The only usable index
 * is `scheduled_visit_route_user_date_idx (route_user_id, visit_date) WHERE
 * deleted_at IS NULL`, which leads on `route_user_id`: starting at
 * `scheduled_visit` and joining upwards gives the planner nothing to seek on
 * and degrades to a sequential scan.
 *
 * Every one of the six tables carries its own `deleted_at IS NULL`, and on the
 * LEFT JOINs the predicate sits in the ON clause — moved to the WHERE it would
 * turn them into inner joins and drop the stops it was meant to filter.
 *
 * Three things worth reading twice:
 *
 *   - `visit` is joined on `scheduled_visit_id`, never on a
 *     (customer, route_user, day) heuristic. `visit_scheduled_visit_uq` is a
 *     partial unique index on that column, so the LEFT JOIN provably returns
 *     at most one execution row per planned stop. The heuristic cannot tell a
 *     dispatch from a collection at the same customer on the same day, which
 *     the wireframe draws as two separate cards.
 *
 *   - `is_extra` is derived, never stored: no live `route_customer` row for
 *     (this route, this customer) means the stop was added outside the route's
 *     planned composition. Prospect stops match nothing by construction —
 *     `sv.customer_id` is NULL for them — so they come out extra for free.
 *
 *   - `zone` and `municipality` are read from `customer` only. `prospect` has
 *     no such columns, which is exactly the contract's "always null for
 *     prospects"; a COALESCE here would be inventing data.
 */
const dailyRouteSql = (userId: string, date: string): Prisma.Sql => Prisma.sql`
  SELECT sv.id::text              AS id,
         ru.id::text              AS route_user_id,
         r.id::text               AS route_id,
         r.name                   AS route_name,
         r.municipality           AS route_municipality,
         r.zone                   AS route_zone,
         sv.stop_type,
         CASE WHEN sv.prospect_id IS NOT NULL THEN 'prospect'
              ELSE 'customer'
         END                      AS target_kind,
         COALESCE(c.id, p.id)::text           AS target_id,
         COALESCE(c.name, p.name)             AS name,
         COALESCE(c.trade_name, p.trade_name) AS trade_name,
         COALESCE(c.address, p.address)       AS address,
         c.zone                   AS zone,
         c.municipality           AS municipality,
         COALESCE(c.phone, p.phone)           AS phone,
         extensions.st_y(COALESCE(c.location, p.location)::extensions.geometry)::float8 AS lat,
         extensions.st_x(COALESCE(c.location, p.location)::extensions.geometry)::float8 AS lng,
         rc.sort_order::int       AS sort_order,
         (rc.id IS NULL)          AS is_extra,
         sv.reason,
         v.started_at             AS completed_at
  FROM   route_user ru
  JOIN   route r ON r.id = ru.route_id
               AND r.deleted_at IS NULL
  JOIN   scheduled_visit sv ON sv.route_user_id = ru.id
                           AND sv.visit_date = ${date}::date
                           AND sv.deleted_at IS NULL
  LEFT   JOIN customer c ON c.id = sv.customer_id
                        AND c.deleted_at IS NULL
  LEFT   JOIN prospect p ON p.id = sv.prospect_id
                        AND p.deleted_at IS NULL
  LEFT   JOIN route_customer rc ON rc.route_id = ru.route_id
                               AND rc.customer_id = sv.customer_id
                               AND rc.deleted_at IS NULL
  LEFT   JOIN visit v ON v.scheduled_visit_id = sv.id
                     AND v.deleted_at IS NULL
  WHERE  ru.user_id = ${userId}::uuid
    AND  ru.deleted_at IS NULL
    /* A stop whose target was soft-deleted would project name and target_id
       as NULL, and the contract says name is never null. Dropping it is the
       only honest option: the business deleted the target, so the card has
       nothing left to show. A block comment, not a line comment: a line
       comment would swallow the rest of the query if anything ever collapsed
       the newlines. */
    AND  COALESCE(c.id, p.id) IS NOT NULL
  ORDER  BY COALESCE(rc.sort_order, ${UNPLANNED_SORT_ORDER}) ASC,
            lower(COALESCE(c.name, p.name)) ASC,
            sv.id ASC
`;
