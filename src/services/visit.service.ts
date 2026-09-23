import { DateTime } from 'luxon';
import { Prisma } from '../generated/prisma/client';
import { Client } from '../lib/prisma';
import { ERP_TIMEZONE } from '../lib/parseErpDate';
import { CustomError } from '../domain/errors/CustomError';
import { ConfirmVisitInput } from '../domain/schemas/visit.schema';
import { ConfirmedVisit } from '../domain/types/visit.types';

// --- Business constants -----------------------------------------------------
//
// None of these live in the database. See CLAUDE.md 5.3 and 5.8.

/**
 * GPS validation radius, in meters (RF-06). Taken from the customer location
 * wireframe.
 *
 * It is NOT persisted per visit: only `visit.distance_meters` is. Changing this
 * value re-evaluates the whole history of out-of-range alerts retroactively,
 * which is intended (CLAUDE.md 5.3).
 */
export const GPS_RADIUS_METERS = 80;

/**
 * How far ahead of the server clock a device timestamp may be. Phone clocks
 * drift a little; anything beyond this is a wrong or tampered clock.
 */
const CLOCK_SKEW_TOLERANCE_MS = 2 * 60 * 1000;

/*
 * ============================================================================
 * 1. MAIN METHODS — called directly by VisitsController, one per route:
 *
 *      POST /api/v1/visits -> confirmVisit
 * ============================================================================
 */

/**
 * RF-06: confirm a planned stop with the seller's GPS position.
 *
 * The API does not block a check-in outside the radius: the mobile UI only
 * enables the confirm button within GPS_RADIUS_METERS, and the server records
 * what it is told. It still computes the distance itself against the customer's
 * pin, so the stored `distance_meters` is authoritative and `within_radius`
 * lets the client (and later the dashboard) flag an inconsistency.
 *
 * `captured_at` is trusted as the moment of the check-in because the app may
 * sync late from a weak or absent connection. It is bounded, though: it cannot
 * be in the future and must fall on the stop's planned day.
 *
 * Idempotent: an offline client retries until it gets an answer. A request that
 * repeats an already confirmed stop — the same `scheduled_visit_id` — with the
 * same `captured_at` returns the existing visit (`replayed: true`) instead of
 * creating a second one. The link is the planned stop, not a
 * (customer, route assignment, visit type, day) heuristic: two stops of the
 * same type at the same customer on the same day are two confirmations.
 *
 * Must run inside a transaction: the advisory lock below is released at commit,
 * and is what stops two concurrent retries from both inserting.
 */
export const confirmVisit = async (
  client: Client,
  sellerId: string,
  input: ConfirmVisitInput
): Promise<ConfirmedVisit> => {
  const stop = await client.scheduled_visit.findFirst({
    where: { id: input.scheduled_visit_id, deleted_at: null },
    select: {
      id: true,
      visit_date: true,
      customer_id: true,
      prospect_id: true,
      stop_type: true,
      route_user_id: true,
      route_user: { select: { user_id: true, route_id: true } },
    },
  });
  if (!stop) throw CustomError.notFound('Scheduled visit not found');

  if (stop.route_user.user_id !== sellerId) {
    throw CustomError.forbidden('This stop is not assigned to you');
  }

  // Planning a stop on a prospect is allowed, executing it is not: visit has
  // no prospect_id (CLAUDE.md 7.1, open decision B-8).
  if (!stop.customer_id) {
    throw CustomError.unprocessable(
      'Stops on prospects cannot be confirmed yet: visits only support customers'
    );
  }

  const day = plannedDayRange(stop.visit_date);
  assertCapturedAt(input.captured_at, day, 'captured_at');
  if (input.finished_at) assertCapturedAt(input.finished_at, day, 'finished_at');

  await client.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${stop.id}, 0))
  `;

  const existing = await findVisitForStop(client, stop.id);
  if (existing) {
    if (existing.started_at.getTime() !== input.captured_at.getTime()) {
      throw CustomError.conflict('This stop was already confirmed');
    }
    return toConfirmed(existing, true);
  }

  const distance = await getDistanceToCustomer(
    client,
    stop.customer_id,
    input.latitude,
    input.longitude
  );

  const routeCustomer = await client.route_customer.findFirst({
    where: {
      route_id: stop.route_user.route_id,
      customer_id: stop.customer_id,
      deleted_at: null,
    },
    select: { id: true },
  });

  const rows = await client.$queryRaw<VisitRow[]>(
    insertVisitSql({
      sellerId,
      customerId: stop.customer_id,
      routeUserId: stop.route_user_id,
      routeCustomerId: routeCustomer?.id ?? null,
      scheduledVisitId: stop.id,
      visitType: stop.stop_type,
      distance,
      input,
    })
  );

  return toConfirmed(rows[0], false);
};

/*
 * ============================================================================
 * 2. OTHER METHODS — validation and mapping helpers behind confirmVisit.
 * ============================================================================
 */

interface DayRange {
  start: Date;
  end: Date;
}

/**
 * [start, end) of the planned day in the customer's timezone.
 *
 * `visit_date` is a `date` column, which Prisma hands back as UTC midnight of
 * that same calendar day. Its ISO date is rebuilt in America/El_Salvador so
 * the range matches the day the seller lived (CLAUDE.md 5.7), and the query
 * uses range predicates on the raw column rather than a `::date` cast.
 */
const plannedDayRange = (visitDate: Date): DayRange => {
  const isoDate = DateTime.fromJSDate(visitDate, { zone: 'utc' }).toISODate();
  const start = DateTime.fromISO(isoDate as string, { zone: ERP_TIMEZONE });

  return { start: start.toJSDate(), end: start.plus({ days: 1 }).toJSDate() };
};

const assertCapturedAt = (value: Date, day: DayRange, field: string): void => {
  if (value.getTime() > Date.now() + CLOCK_SKEW_TOLERANCE_MS) {
    throw CustomError.unprocessable(`${field} cannot be in the future`);
  }

  if (value < day.start || value >= day.end) {
    throw CustomError.unprocessable(
      `${field} must fall on the planned day of the stop`
    );
  }
};

/**
 * Distance in meters from the reported position to the customer's pin.
 * geography ST_Distance is a spheroidal distance, so it is already in meters.
 */
const getDistanceToCustomer = async (
  client: Client,
  customerId: string,
  latitude: number,
  longitude: number
): Promise<number> => {
  const rows = await client.$queryRaw<{ distance: number | null }[]>(Prisma.sql`
    SELECT ROUND(
             extensions.ST_Distance(
               c.location,
               extensions.ST_SetSRID(
                 extensions.ST_MakePoint(${longitude}, ${latitude}),
                 4326
               )::extensions.geography
             )::numeric,
             2
           )::float8 AS distance
    FROM   customer c
    WHERE  c.id = ${customerId}::uuid
      AND  c.deleted_at IS NULL
  `);

  if (rows.length === 0) throw CustomError.notFound('Customer not found');

  const distance = rows[0].distance;
  if (distance === null) {
    // Without a pin there is nothing to validate against. Better to refuse than
    // to store a visit that nobody can audit.
    throw CustomError.unprocessable('Customer has no GPS location assigned');
  }

  return distance;
};

/**
 * The visit already recorded for this planned stop, if any.
 *
 * Keyed on `scheduled_visit_id`, which `visit_scheduled_visit_uq` keeps unique
 * among live rows. A (customer, route_user, visit_type, day) match cannot
 * tell two stops of the same type apart, and it is not what getDailyRoute
 * joins on.
 */
const findVisitForStop = async (
  client: Client,
  scheduledVisitId: string
): Promise<VisitRow | null> => {
  const rows = await client.$queryRaw<VisitRow[]>(Prisma.sql`
    SELECT ${visitColumns('v')}
    FROM   visit v
    WHERE  v.scheduled_visit_id = ${scheduledVisitId}::uuid
      AND  v.deleted_at IS NULL
    LIMIT  1
  `);

  return rows[0] ?? null;
};

const toConfirmed = (row: VisitRow, replayed: boolean): ConfirmedVisit => ({
  id: row.id,
  scheduled_visit_id: row.scheduled_visit_id,
  customer_id: row.customer_id,
  visit_type: row.visit_type,
  started_at: row.started_at,
  finished_at: row.finished_at,
  location: { lat: row.lat, lng: row.lng },
  distance_meters: row.distance_meters,
  within_radius: row.distance_meters <= GPS_RADIUS_METERS,
  radius_meters: GPS_RADIUS_METERS,
  successful: row.successful,
  no_order_reason: row.no_order_reason,
  notes: row.notes,
  replayed,
});

/*
 * ============================================================================
 * 3. RAW SQL — `visit.checkin_location` is Unsupported("geography") in Prisma,
 *    so both the write and the read of it go through $queryRaw.
 * ============================================================================
 */

/** Row shared by the INSERT ... RETURNING and the idempotency lookup. */
interface VisitRow {
  id: string;
  scheduled_visit_id: string;
  customer_id: string;
  visit_type: string;
  started_at: Date;
  finished_at: Date | null;
  lat: number;
  lng: number;
  distance_meters: number;
  successful: boolean | null;
  no_order_reason: string | null;
  notes: string | null;
}

/** Column list of VisitRow, prefixed with the alias of the visit relation. */
const visitColumns = (alias: string): Prisma.Sql =>
  Prisma.raw(`
    ${alias}.id::text                                             AS id,
    ${alias}.scheduled_visit_id::text                             AS scheduled_visit_id,
    ${alias}.customer_id::text                                    AS customer_id,
    ${alias}.visit_type,
    ${alias}.started_at,
    ${alias}.finished_at,
    extensions.st_y(${alias}.checkin_location::extensions.geometry)::float8 AS lat,
    extensions.st_x(${alias}.checkin_location::extensions.geometry)::float8 AS lng,
    ${alias}.distance_meters::float8                              AS distance_meters,
    ${alias}.successful,
    ${alias}.no_order_reason,
    ${alias}.notes
  `);

const insertVisitSql = (args: {
  sellerId: string;
  customerId: string;
  routeUserId: string;
  routeCustomerId: string | null;
  scheduledVisitId: string;
  visitType: string;
  distance: number;
  input: ConfirmVisitInput;
}): Prisma.Sql => {
  const { input } = args;

  return Prisma.sql`
    INSERT INTO visit AS v (
      customer_id, user_id, route_user_id, route_customer_id, scheduled_visit_id,
      started_at, finished_at, checkin_location, distance_meters,
      visit_type, successful, no_order_reason, notes
    )
    VALUES (
      ${args.customerId}::uuid,
      ${args.sellerId}::uuid,
      ${args.routeUserId}::uuid,
      ${args.routeCustomerId}::uuid,
      ${args.scheduledVisitId}::uuid,
      ${input.captured_at}::timestamptz,
      ${input.finished_at ?? null}::timestamptz,
      extensions.ST_SetSRID(
        extensions.ST_MakePoint(${input.longitude}, ${input.latitude}),
        4326
      )::extensions.geography,
      ${args.distance}::numeric,
      ${args.visitType},
      ${input.successful ?? null}::boolean,
      ${input.no_order_reason ?? null},
      ${input.notes ?? null}
    )
    RETURNING ${visitColumns('v')}
  `;
};
