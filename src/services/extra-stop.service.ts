import { DateTime } from 'luxon';
import { Client } from '../lib/prisma';
import { CustomError } from '../domain/errors/CustomError';
import { ROLES } from '../domain/types/auth.types';
import { CreateExtraStopInput } from '../domain/schemas/extra-stop.schema';
import { ExtraStop, EXTRA_STOP_ERROR_CODES } from '../domain/types/extra-stop.types';
import { customerHasGps } from '../repositories/extra-stop.repository';
import { DailyRoute } from '../domain/types/daily-route.types';
import { ensureDailyStops, getDailyRoute, todayInBusinessZone } from './daily-route.service';

// Same business timezone daily-route.service.ts uses for "today" (CLAUDE.md
// 5.7): a stop dated "today" has to mean today in El Salvador, not the
// server's, on both sides of the check.
const BUSINESS_TIME_ZONE = 'America/El_Salvador';

/*
 * ============================================================================
 * 1. MAIN METHODS — called directly by the seller-daily-route controller:
 *
 *      POST   /api/v1/sellers/:sellerId/daily-route/extra-stops     -> createExtraStop
 *      DELETE /api/v1/sellers/:sellerId/daily-route/extra-stops/:stopId -> deleteExtraStop
 *      GET    /api/v1/sellers/:sellerId/daily-route                 -> getExtraStopsDay
 * ============================================================================
 */

/**
 * PCRM-158: an Administrador adds a stop for one specific date, outside the
 * route's planned composition. `route_customer` / `route_user` are never
 * touched (CLAUDE.md 5.1) — only a flagged `scheduled_visit` row is created.
 *
 * Must run inside a transaction: the advisory lock below is released at
 * commit, and is what stops two concurrent requests from both winning the
 * duplicate check for the same seller and day.
 */
export const createExtraStop = async (
  client: Client,
  sellerId: string,
  input: CreateExtraStopInput
): Promise<ExtraStop> => {
  const today = todayInBusinessZone();
  if (input.date < today) {
    throw CustomError.badRequest('date cannot be in the past', EXTRA_STOP_ERROR_CODES.EXTRA_STOP_PAST_DATE);
  }

  const seller = await client.app_user.findFirst({
    where: { id: sellerId, deleted_at: null, role: ROLES.SELLER },
    select: { id: true, active: true },
  });
  if (!seller) throw CustomError.notFound('Seller not found', EXTRA_STOP_ERROR_CODES.SELLER_NOT_FOUND);
  if (!seller.active) throw CustomError.unprocessable('Seller is inactive', EXTRA_STOP_ERROR_CODES.SELLER_INACTIVE);

  const customer = await client.customer.findFirst({
    where: { id: input.customer_id, deleted_at: null, active: true },
    select: { id: true, name: true },
  });
  if (!customer) throw CustomError.notFound('Customer not found', EXTRA_STOP_ERROR_CODES.CUSTOMER_NOT_FOUND);

  const hasGps = await customerHasGps(client, customer.id);
  if (!hasGps) throw CustomError.unprocessable('Customer has no GPS location', EXTRA_STOP_ERROR_CODES.CUSTOMER_NO_GPS);

  const assignment = await resolveAssignment(client, sellerId, input);

  const visitDate = visitDateOf(input.date);

  await client.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${`${sellerId}:${input.date}`}))
  `;

  // PCRM-161: generates the day's planned stops before checking for a
  // duplicate, so an extra that collides with a customer+type the weekly
  // route already plans for that day is caught here as EXTRA_STOP_DUPLICATE,
  // even if nobody had opened the seller's day yet.
  await ensureDailyStops(client, sellerId, input.date);

  const duplicate = await client.scheduled_visit.findFirst({
    where: {
      visit_date: visitDate,
      customer_id: input.customer_id,
      stop_type: input.stop_type,
      deleted_at: null,
      route_user: { user_id: sellerId },
    },
    select: { id: true },
  });
  if (duplicate) {
    throw CustomError.conflict('Customer already has a stop of this type on that date', EXTRA_STOP_ERROR_CODES.EXTRA_STOP_DUPLICATE);
  }

  let created;
  try {
    created = await client.scheduled_visit.create({
      data: {
        route_user_id: assignment.id,
        visit_date: visitDate,
        customer_id: input.customer_id,
        stop_type: input.stop_type,
        reason: input.reason ?? null,
        is_extra: true,
      },
      select: { id: true, created_at: true },
    });
  } catch (error) {
    if (isUniqueConstraintError(error, 'scheduled_visit_extra_uq')) {
      throw CustomError.conflict('Customer already has a stop of this type on that date', EXTRA_STOP_ERROR_CODES.EXTRA_STOP_DUPLICATE);
    }
    throw error;
  }

  return {
    id: created.id,
    seller_id: sellerId,
    route_user_id: assignment.id,
    route_id: assignment.route_id,
    route_name: assignment.route.name,
    date: input.date,
    customer_id: input.customer_id,
    customer_name: customer.name,
    stop_type: input.stop_type,
    reason: input.reason ?? null,
    is_extra: true,
    created_at: created.created_at,
  };
};

/**
 * Deletes an extra stop while it has no check-in yet and the date is not in
 * the past. A planned (non-extra) stop id, or one belonging to another seller,
 * also answers 404: this endpoint only ever removes what it can add.
 */
export const deleteExtraStop = async (
  client: Client,
  sellerId: string,
  stopId: string
): Promise<{ id: string; deleted: true }> => {
  const stop = await client.scheduled_visit.findFirst({
    where: {
      id: stopId,
      is_extra: true,
      deleted_at: null,
      route_user: { user_id: sellerId },
    },
    select: { id: true, visit_date: true },
  });
  if (!stop) throw CustomError.notFound('Extra stop not found', EXTRA_STOP_ERROR_CODES.EXTRA_STOP_NOT_FOUND);

  const checkedIn = await client.visit.findFirst({
    where: { scheduled_visit_id: stopId, deleted_at: null },
    select: { id: true },
  });
  if (checkedIn) {
    throw CustomError.conflict('Extra stop already has a check-in and cannot be deleted', EXTRA_STOP_ERROR_CODES.EXTRA_STOP_HAS_CHECKIN);
  }

  const today = todayInBusinessZone();
  const stopDateString = stop.visit_date.toISOString().slice(0, 10);
  if (stopDateString < today) {
    throw CustomError.unprocessable('Extra stops dated in the past cannot be deleted', EXTRA_STOP_ERROR_CODES.EXTRA_STOP_DELETE_PAST);
  }

  const now = new Date();
  await client.scheduled_visit.update({
    where: { id: stopId },
    data: { deleted_at: now, updated_at: now },
  });

  return { id: stopId, deleted: true };
};

/**
 * A seller's day, extras included, for the Web to show what it can delete
 * (PCRM-158). Extends getDailyRoute to include all active route assignments
 * for the day, even those with no stops yet, so the Web can add stops on them.
 * ADMIN endpoint only.
 */
export const getExtraStopsDay = async (
  client: Client,
  sellerId: string,
  date?: string
): Promise<DailyRoute> => {
  const seller = await client.app_user.findFirst({
    where: { id: sellerId, deleted_at: null, role: ROLES.SELLER },
    select: { id: true },
  });
  if (!seller) throw CustomError.notFound('Seller not found', EXTRA_STOP_ERROR_CODES.SELLER_NOT_FOUND);

  const visitDate = date ?? todayInBusinessZone();
  const dailyRoute = await getDailyRoute(client, sellerId, visitDate);
  const activeAssignments = await findActiveAssignments(client, sellerId, visitDate);

  // Merge active assignments into routes, deduped by route_user_id.
  // Assignments not already in dailyRoute.routes get added; those already
  // present are kept as-is to preserve any stops tied to them.
  const byAssignmentId = new Map(
    dailyRoute.routes.map((r) => [r.route_user_id, r])
  );

  for (const assignment of activeAssignments) {
    if (!byAssignmentId.has(assignment.id)) {
      byAssignmentId.set(assignment.id, {
        id: assignment.route_id,
        route_user_id: assignment.id,
        name: assignment.route.name,
        municipality: assignment.route.municipality,
        zone: assignment.route.zone,
      });
    }
  }

  return {
    ...dailyRoute,
    routes: [...byAssignmentId.values()],
  };
};

/*
 * ============================================================================
 * 2. OTHER METHODS — assignment resolution behind createExtraStop.
 * ============================================================================
 */

interface Assignment {
  id: string;
  route_id: string;
  route: { name: string };
}

interface ActiveAssignment {
  id: string;
  route_id: string;
  route: { name: string; municipality: string | null; zone: string | null };
}

/**
 * The seller's live route_user assignments on a given date, filtered by
 * weekday. Returns rows where the route itself is also active (not soft-deleted,
 * active = true).
 *
 * Ordered by route name asc for stable, predictable ordering.
 */
const findActiveAssignments = async (
  client: Client,
  sellerId: string,
  date: string
): Promise<ActiveAssignment[]> => {
  const weekday = DateTime.fromISO(date, { zone: BUSINESS_TIME_ZONE }).weekday;

  return client.route_user.findMany({
    where: {
      user_id: sellerId,
      day: weekday,
      deleted_at: null,
      route: { deleted_at: null, active: true },
    },
    select: {
      id: true,
      route_id: true,
      route: { select: { name: true, municipality: true, zone: true } },
    },
    orderBy: { route: { name: 'asc' } },
  });
};

/**
 * The seller's route_user assignment the stop hangs off, resolved from
 * `input.date`'s weekday (1 = Monday ... 7 = Sunday, matching
 * `route_user.day` and CLAUDE.md 5.1) rather than a stored calendar row: the
 * assignment is recurring, not per-jornada.
 *
 * Only active assignments (route.active = true) are considered; inactive
 * routes are silently ignored. If an explicit route_id points to an inactive
 * route, ROUTE_NOT_ASSIGNED is thrown.
 */
const resolveAssignment = async (
  client: Client,
  sellerId: string,
  input: CreateExtraStopInput
): Promise<Assignment> => {
  const activeAssignments = await findActiveAssignments(client, sellerId, input.date);

  if (activeAssignments.length === 0) {
    throw CustomError.unprocessable('Seller has no route assigned on that date', EXTRA_STOP_ERROR_CODES.SELLER_NO_ROUTE_ON_DATE);
  }

  if (input.route_id) {
    const assignment = activeAssignments.find((a) => a.route_id === input.route_id);
    if (!assignment) {
      throw CustomError.unprocessable('route_id is not assigned to this seller on that date', EXTRA_STOP_ERROR_CODES.ROUTE_NOT_ASSIGNED);
    }
    return { id: assignment.id, route_id: assignment.route_id, route: { name: assignment.route.name } };
  }

  if (activeAssignments.length > 1) {
    throw CustomError.unprocessable('Seller has more than one route on that date; route_id is required', EXTRA_STOP_ERROR_CODES.ROUTE_ID_REQUIRED);
  }

  return {
    id: activeAssignments[0].id,
    route_id: activeAssignments[0].route_id,
    route: { name: activeAssignments[0].route.name },
  };
};

/** `scheduled_visit.visit_date` is a `date` column: midnight UTC of that calendar day. */
const visitDateOf = (date: string): Date => new Date(`${date}T00:00:00.000Z`);

/** Prisma P2002 on the named unique constraint/index. */
const isUniqueConstraintError = (error: unknown, target: string): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: string }).code === 'P2002' &&
  JSON.stringify((error as { meta?: unknown }).meta ?? '').includes(target);
