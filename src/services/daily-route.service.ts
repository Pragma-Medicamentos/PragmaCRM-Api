import { DateTime } from 'luxon';
import { Prisma } from '../generated/prisma/client';
import { Client } from '../lib/prisma';
import { CustomError } from '../domain/errors/CustomError';
import {
  SetStopLocationInput,
  SetStopNoteInput,
  StopType,
} from '../domain/schemas/daily-route.schema';
import {
  DailyRoute,
  DailyRouteStop,
  RouteRef,
  StopCustomerLocation,
  StopCustomerMetrics,
  StopNote,
  TargetKind,
} from '../domain/types/daily-route.types';
import { getCustomerSummary, getRecentVisitNotes } from './customer.service';
import { GPS_RADIUS_METERS } from './visit.service';
import { generateDailyStops } from '../repositories/daily-route.repository';
import { historicalStopVisibleSql } from '../repositories/route-history/route-history.sql';

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
 *      GET   /api/v1/me/route                     -> getDailyRoute
 *      PATCH /api/v1/me/route/stops/:id/location  -> setStopCustomerLocation
 *      PATCH /api/v1/me/route/stops/:id/note      -> setStopNote
 *      GET   /api/v1/me/route/stops/:id/customer  -> getStopCustomerMetrics
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
  const today = todayInBusinessZone();
  const visitDate = date ?? today;

  await ensureDailyStops(client, userId, visitDate);

  const rows = await client.$queryRaw<DailyRouteStopRow[]>(
    dailyRouteSql(userId, visitDate, visitDate < today)
  );

  return {
    date: visitDate,
    routes: toRoutes(rows),
    stops: rows.map(toStop),
  };
};

/**
 * PCRM-160: the seller fixes the GPS pin of a stop's customer while standing
 * at it, so a customer nobody ever located can be visited and validated.
 *
 * Deliberately narrower than the admin's PATCH /customers/:id/location
 * (RF-02): it only fills an EMPTY pin. Moving an existing one stays an admin
 * action, because every past and future visit to that customer is validated
 * against it. The `location IS NULL` guard lives in the UPDATE itself rather
 * than in a prior read, so two concurrent requests cannot both write — the
 * loser simply matches no row and gets the 409.
 *
 * Keyed by the stop, not the customer: the seller's app only knows stops, and
 * going through `scheduled_visit -> route_user` is what proves the customer is
 * on this seller's agenda. Any date is accepted, like confirmVisit: the stop
 * being assigned to the seller is the authorisation.
 */
export const setStopCustomerLocation = async (
  client: Client,
  sellerId: string,
  stopId: string,
  input: SetStopLocationInput
): Promise<StopCustomerLocation> => {
  // Coarser than the validation radius and the pin could sit outside the
  // circle the seller must later stand in to confirm a visit. The app refuses
  // the same readings; this is the authoritative copy of that rule.
  if (input.accuracy_meters > GPS_RADIUS_METERS) {
    throw CustomError.unprocessable(
      `GPS accuracy must be ${GPS_RADIUS_METERS} m or better to set a location`
    );
  }

  const stop = await findOwnedStop(client, sellerId, stopId);

  // `prospect.location` exists, but prospects are registered with their pin
  // (PCRM-62) and a visit cannot be executed on one anyway.
  if (!stop.customer_id) {
    throw CustomError.unprocessable(
      'Locations can only be set on customer stops'
    );
  }

  const updated = await client.$executeRaw(
    setEmptyCustomerLocationSql(
      stop.customer_id,
      input.latitude,
      input.longitude
    )
  );

  if (updated === 0) {
    throw CustomError.conflict('This customer already has a location');
  }

  return {
    customer_id: stop.customer_id,
    location: { lat: input.latitude, lng: input.longitude },
  };
};

/**
 * RF-07: the seller adds or rewrites the note of a stop he already completed.
 *
 * The note lives on `visit`, the execution, so a stop with no linked visit
 * has nothing to attach it to and gets a 409 — it is a state the seller can
 * still leave by confirming the stop, which can carry the note itself.
 *
 * Editable only on the stop's planned day, in the business timezone. RF-08
 * shows these notes to the admin as the record of what happened in the
 * field; a seller rewriting last week's note would be rewriting that record.
 *
 * The note replaces the previous one rather than appending to it, so a retry
 * from an offline client is idempotent.
 */
export const setStopNote = async (
  client: Client,
  sellerId: string,
  stopId: string,
  input: SetStopNoteInput
): Promise<StopNote> => {
  const stop = await client.scheduled_visit.findFirst({
    where: { id: stopId, deleted_at: null },
    select: {
      visit_date: true,
      route_user: { select: { user_id: true, deleted_at: true } },
    },
  });
  if (!stop || stop.route_user.deleted_at !== null) {
    throw CustomError.notFound('Scheduled visit not found');
  }

  if (stop.route_user.user_id !== sellerId) {
    throw CustomError.forbidden('This stop is not assigned to you');
  }

  // `visit_date` is a `date` column, handed back as UTC midnight of that day.
  const stopDate = DateTime.fromJSDate(stop.visit_date, { zone: 'utc' }).toISODate();
  if (stopDate !== todayInBusinessZone()) {
    throw CustomError.unprocessable(
      'Notes can only be added on the planned day of the stop'
    );
  }

  // Looked up by the column, not through the 1:1 relation: the unique index
  // behind it is partial on deleted_at, so a soft-deleted visit can coexist
  // with the live one.
  const visit = await client.visit.findFirst({
    where: { scheduled_visit_id: stopId, deleted_at: null },
    select: { id: true },
  });
  if (!visit) {
    throw CustomError.conflict('This stop has not been completed yet');
  }

  // updated_at is stamped by the visit_set_updated_at trigger.
  const updated = await client.visit.update({
    where: { id: visit.id },
    data: { notes: input.notes },
    select: { id: true, updated_at: true },
  });

  return {
    id: stopId,
    visit_id: updated.id,
    notes: input.notes,
    updated_at: updated.updated_at,
  };
};

/**
 * PCRM-164: the commercial figures of a stop's customer, so the seller can
 * prepare the visit without leaving the route.
 *
 * The admin's GET /customers/:id stays admin-only (RF-02). This is the
 * seller's narrower door to the same numbers: keyed by the stop, so it opens
 * only for customers on the seller's own agenda — the same proof
 * setStopCustomerLocation relies on — and it reuses the profile's readers, so
 * the app and the dashboard cannot disagree on a figure. Sales history and
 * the credit tab are not exposed.
 */
export const getStopCustomerMetrics = async (
  client: Client,
  sellerId: string,
  stopId: string
): Promise<StopCustomerMetrics> => {
  const stop = await findOwnedStop(client, sellerId, stopId);

  // Prospects have no sales, visits or credit yet: there is nothing to show.
  if (!stop.customer_id) {
    throw CustomError.unprocessable(
      'Metrics are only available on customer stops'
    );
  }

  const [summary, notes] = await Promise.all([
    getCustomerSummary(client, stop.customer_id),
    getRecentVisitNotes(client, stop.customer_id),
  ]);

  const { category, ...metrics } = summary;

  return {
    customer_id: stop.customer_id,
    category,
    summary: metrics,
    recent_notes: notes,
  };
};

/**
 * PCRM-161: generates the seller's planned stops for `date` from the weekly
 * route composition, on demand rather than through a nightly job. Called by
 * `getDailyRoute` before its SELECT, so both `/me/route` and the admin
 * `sellers/:sellerId/daily-route` GET (which calls `getDailyRoute`
 * internally, see extra-stop.service.ts) generate the same way.
 *
 * A date in the past is read as-is and never generated: there is nothing to
 * plan for a day already gone, and generating one retroactively would
 * fabricate a plan that never existed. Today or a future date always runs
 * the statement — see generate-stops.sql.ts for why running it twice, or
 * concurrently, is safe.
 */
export const ensureDailyStops = async (
  client: Client,
  sellerId: string,
  date: string
): Promise<number> => {
  if (date < todayInBusinessZone()) return 0;

  const isoWeekday = DateTime.fromISO(date, { zone: BUSINESS_TIME_ZONE }).weekday;
  return generateDailyStops(client, sellerId, date, isoWeekday);
};


/*
 * ============================================================================
 * 2. OTHER METHODS — the date default, the stop ownership check and the
 *    row→DTO mappers. Private: the endpoints are the only consumers, and the
 *    mappers only make sense against the row shape produced by section 3.
 * ============================================================================
 */

/**
 * Today in the business timezone, as `YYYY-MM-DD`. See BUSINESS_TIME_ZONE.
 *
 * Exported for extra-stop.service.ts (PCRM-158): the "date cannot be in the
 * past" rule has to compare against the same El Salvador today this module
 * already resolves, not the server's.
 */
export const todayInBusinessZone = (): string => {
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
 * The stop, provided it is on `sellerId`'s agenda. Going through
 * `scheduled_visit -> route_user` is what authorises the stop endpoints: any
 * date is accepted, like confirmVisit, because the stop being assigned to the
 * seller is the authorisation.
 *
 * 404 for a stop that does not exist or whose assignment was deleted; 403 for
 * one that belongs to another seller.
 */
const findOwnedStop = async (
  client: Client,
  sellerId: string,
  stopId: string
): Promise<{ customer_id: string | null }> => {
  const stop = await client.scheduled_visit.findFirst({
    where: { id: stopId, deleted_at: null },
    select: {
      customer_id: true,
      route_user: { select: { user_id: true, deleted_at: true } },
    },
  });
  if (!stop || stop.route_user.deleted_at !== null) {
    throw CustomError.notFound('Scheduled visit not found');
  }

  if (stop.route_user.user_id !== sellerId) {
    throw CustomError.forbidden('This stop is not assigned to you');
  }

  return { customer_id: stop.customer_id };
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
    checkin_lat,
    checkin_lng,
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
    checkin_location:
      checkin_lat !== null && checkin_lng !== null
        ? { lat: checkin_lat, lng: checkin_lng }
        : null,
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
  personality: string | null;
  potential: string | null;
  establishment_type: string | null;
  credit_limit: number | null;
  lat: number | null;
  lng: number | null;
  sort_order: number | null;
  is_extra: boolean;
  reason: string | null;
  completed_at: Date | null;
  notes: string | null;
  checkin_lat: number | null;
  checkin_lng: number | null;
  distance_meters: number | null;
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
 * All six tables it touches carry their own `deleted_at IS NULL` —
 * `route_user`, `route`, `scheduled_visit`, `customer`, `prospect` and
 * `visit`. On the LEFT JOINs the predicate sits in the ON clause: moved to
 * the WHERE it would turn them into inner joins and drop the very stops it
 * was meant to keep. The one exception is a past day (`isPastDay`): there
 * `route_user` and `route` go through historicalStopVisibleSql instead
 * (PCRM-203), so a reassignment does not erase the seller's history.
 *
 * Four things worth reading twice:
 *
 *   - `visit` is joined on `scheduled_visit_id`, never on a
 *     (customer, route_user, day) heuristic. `visit_scheduled_visit_uq` is a
 *     partial unique index on that column, so the LEFT JOIN provably returns
 *     at most one execution row per planned stop. The heuristic cannot tell a
 *     dispatch from a collection at the same customer on the same day, which
 *     the wireframe draws as two separate cards.
 *
 *   - `is_extra` and `sort_order` come only from `scheduled_visit` — there is
 *     no `route_customer` join here (PCRM-161). `is_extra` is
 *     `sv.is_extra OR sv.prospect_id IS NOT NULL`: the stamped flag (an
 *     admin's PCRM-158 one-off, or an ordinary generated stop) ORed with "is
 *     this a prospect", which is extra by definition since prospects have no
 *     route membership at all. `sort_order` is the frozen copy the PCRM-161
 *     generation statement stamped onto the row at insert time — reading the
 *     live `route_customer.sort_order` instead would let a later reorder of
 *     the route change a day already handed out to the seller. It is forced
 *     to NULL on any extra, even an admin Cobro added on a customer who *is*
 *     a route member: an extra stop is never part of the planned order.
 *
 *   - `zone` and `municipality` are read from `customer` only. `prospect` has
 *     no such columns, which is exactly the contract's "always null for
 *     prospects"; a COALESCE here would be inventing data.
 *
 *   - Two clauses here drop rows silently, and they are the same class of
 *     problem: the INNER JOIN to `route`, and the
 *     `COALESCE(c.id, p.id) IS NOT NULL` in the WHERE. Both exist because the
 *     contract promises a non-null `name`, and both make a live
 *     `scheduled_visit` disappear when the thing it points at was soft-deleted
 *     — a route in the first case, a customer or prospect in the second. The
 *     query cannot even report how many it dropped: they are gone before the
 *     projection runs. See the comments at each site.
 */
const dailyRouteSql = (
  userId: string,
  date: string,
  isPastDay: boolean
): Prisma.Sql => Prisma.sql`
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
         c.personality            AS personality,
         c.potential              AS potential,
         c.establishment_type     AS establishment_type,
         c.credit_limit::float8   AS credit_limit,
         extensions.st_y(COALESCE(c.location, p.location)::extensions.geometry)::float8 AS lat,
         extensions.st_x(COALESCE(c.location, p.location)::extensions.geometry)::float8 AS lng,
         (CASE WHEN sv.is_extra OR sv.prospect_id IS NOT NULL THEN NULL ELSE sv.sort_order END)::int AS sort_order,
         (sv.is_extra OR sv.prospect_id IS NOT NULL) AS is_extra,
         sv.reason,
         v.started_at             AS completed_at,
         v.notes                  AS notes,
         extensions.st_y(v.checkin_location::extensions.geometry)::float8 AS checkin_lat,
         extensions.st_x(v.checkin_location::extensions.geometry)::float8 AS checkin_lng,
         v.distance_meters::float8 AS distance_meters
  FROM   route_user ru
  /* INNER on purpose, not the LEFT JOIN the rest of this query uses.
     route.name is NOT NULL and RouteRef.name is typed as a plain string; a
     LEFT JOIN would let a soft-deleted route project a NULL name and make
     that type a lie. The cost is real and unsignalled: soft-delete a route whose
     assignment still has stops today and the seller gets an empty 200 with no
     explanation, rather than a route he can see is gone. The missing half is
     cascading the soft delete from route to route_user and scheduled_visit,
     which belongs to its own ticket -- this query only refuses to invent a
     name it does not have. */
  JOIN   route r ON r.id = ru.route_id
               ${isPastDay ? Prisma.empty : Prisma.sql`AND r.deleted_at IS NULL`}
  JOIN   scheduled_visit sv ON sv.route_user_id = ru.id
                           AND sv.visit_date = ${date}::date
                           AND sv.deleted_at IS NULL
  LEFT   JOIN customer c ON c.id = sv.customer_id
                        AND c.deleted_at IS NULL
  LEFT   JOIN prospect p ON p.id = sv.prospect_id
                        AND p.deleted_at IS NULL
  LEFT   JOIN visit v ON v.scheduled_visit_id = sv.id
                     AND v.deleted_at IS NULL
  WHERE  ru.user_id = ${userId}::uuid
    /* Today and later follow the live assignment. A past day is the record
       of what the seller had, so a later reassignment or route deletion must
       not erase it (PCRM-203): see historicalStopVisibleSql, which the
       history list applies too, so its counts match this detail. */
    AND  ${isPastDay ? historicalStopVisibleSql : Prisma.sql`ru.deleted_at IS NULL`}
    /* A stop whose target was soft-deleted would project name and target_id
       as NULL, and the contract says name is never null. Dropping it is the
       only honest option: the business deleted the target, so the card has
       nothing left to show.

       Same class of silent drop as the INNER JOIN to route above, and it
       shares the same gap: the stop vanishes with nothing to tell the seller
       it existed, and the query cannot count what it removed. The real fix is
       cascading the soft delete down to scheduled_visit, in its own ticket.

       A block comment, not a line comment: a line comment would swallow the
       rest of the query if anything ever collapsed the newlines. */
    AND  COALESCE(c.id, p.id) IS NOT NULL
  ORDER  BY COALESCE(CASE WHEN sv.is_extra OR sv.prospect_id IS NOT NULL THEN NULL ELSE sv.sort_order END, ${UNPLANNED_SORT_ORDER}) ASC,
            lower(COALESCE(c.name, p.name)) ASC,
            sv.id ASC
`;

/**
 * SQL for setStopCustomerLocation. Writes only when the pin is still empty:
 * the affected-row count (0 or 1) is how the service tells a fresh write from
 * a customer that already had a location.
 *
 * Same point construction as the admin's setCustomerLocationSql — longitude
 * first, as ST_MakePoint expects.
 */
const setEmptyCustomerLocationSql = (
  customerId: string,
  latitude: number,
  longitude: number
): Prisma.Sql => Prisma.sql`
  UPDATE customer
  SET    location = extensions.ST_SetSRID(
           extensions.ST_MakePoint(${longitude}, ${latitude}),
           4326
         )::extensions.geography,
         updated_at = now()
  WHERE  id = ${customerId}::uuid
    AND  deleted_at IS NULL
    AND  location IS NULL
`;
