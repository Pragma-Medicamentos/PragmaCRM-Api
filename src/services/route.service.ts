import { Client } from '../lib/prisma';
import { CustomError } from '../domain/errors/CustomError';
import { ROLES } from '../domain/types/auth.types';
import { CreateRouteInput, UpdateRouteInput } from '../domain/schemas/route.schema';

export interface RouteRecord {
  id: string;
  name: string;
  municipality: string | null;
  zone: string | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface RouteAssignmentRecord {
  id: string;
  route_id: string;
  user_id: string;
  user_name: string;
  day: number | null;
  status: string | null;
  created_at: Date;
  updated_at: Date;
}

const ROUTE_SELECT = {
  id: true,
  name: true,
  municipality: true,
  zone: true,
  active: true,
  created_at: true,
  updated_at: true,
} as const;

export const listRoutes = (
  client: Client,
  filters: { active?: boolean }
): Promise<RouteRecord[]> =>
  client.route.findMany({
    where: {
      deleted_at: null,
      ...(filters.active !== undefined ? { active: filters.active } : {}),
    },
    select: ROUTE_SELECT,
    orderBy: { name: 'asc' },
  });

export const getRouteById = async (
  client: Client,
  id: string
): Promise<RouteRecord> => {
  const route = await client.route.findFirst({
    where: { id, deleted_at: null },
    select: ROUTE_SELECT,
  });

  if (!route) throw CustomError.notFound('Route not found');

  return route;
};

export const createRoute = (
  client: Client,
  data: CreateRouteInput
): Promise<RouteRecord> =>
  client.route.create({
    data: {
      name: data.name,
      municipality: data.municipality,
      zone: data.zone,
      active: true,
    },
    select: ROUTE_SELECT,
  });

export const updateRoute = async (
  client: Client,
  id: string,
  data: UpdateRouteInput
): Promise<RouteRecord> => {
  await getRouteById(client, id);

  return client.route.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.municipality !== undefined ? { municipality: data.municipality } : {}),
      ...(data.zone !== undefined ? { zone: data.zone } : {}),
      ...(data.active !== undefined ? { active: data.active } : {}),
      updated_at: new Date(),
    },
    select: ROUTE_SELECT,
  });
};

/** Currently active (non soft-deleted) vendor assignments for a route, one per day. */
export const listRouteAssignments = async (
  client: Client,
  routeId: string
): Promise<RouteAssignmentRecord[]> => {
  const rows = await client.route_user.findMany({
    where: { route_id: routeId, deleted_at: null },
    select: {
      id: true,
      route_id: true,
      user_id: true,
      day: true,
      status: true,
      created_at: true,
      updated_at: true,
      app_user: { select: { name: true } },
    },
    orderBy: { day: 'asc' },
  });

  return rows.map(({ app_user, ...row }) => ({ ...row, user_name: app_user.name }));
};

export const getActiveAssignmentForDay = (
  client: Client,
  routeId: string,
  day: number
): Promise<{ id: string; user_id: string } | null> =>
  client.route_user.findFirst({
    where: { route_id: routeId, day, deleted_at: null },
    select: { id: true, user_id: true },
  });

/**
 * Guards against assigning a route to an Administrador, or to a Vendedor
 * account that is disabled or soft-deleted.
 */
export const assertActiveSeller = async (
  client: Client,
  userId: string
): Promise<void> => {
  const seller = await client.app_user.findFirst({
    where: { id: userId, deleted_at: null },
    select: { role: true, active: true },
  });

  if (!seller) throw CustomError.notFound('Vendor not found');
  if (seller.role !== ROLES.SELLER) {
    throw CustomError.badRequest('User is not a Vendedor');
  }
  if (!seller.active) throw CustomError.badRequest('Vendor is not active');
};

export const createRouteAssignment = (
  client: Client,
  routeId: string,
  data: { user_id: string; day: number }
): Promise<RouteAssignmentRecord> =>
  client.route_user
    .create({
      data: {
        route_id: routeId,
        user_id: data.user_id,
        day: data.day,
      },
      select: {
        id: true,
        route_id: true,
        user_id: true,
        day: true,
        status: true,
        created_at: true,
        updated_at: true,
        app_user: { select: { name: true } },
      },
    })
    .then(({ app_user, ...row }) => ({ ...row, user_name: app_user.name }));

/**
 * Serializes concurrent assignment attempts on the same (route, day):
 * route_user's unique key is (route_id, user_id, day), not (route_id, day),
 * so nothing in the schema stops two different vendors landing on the same
 * day if two requests race the "is this day free" check. Must run inside a
 * $transaction — the lock is released at commit/rollback, not per statement.
 */
export const lockRouteDay = (
  client: Client,
  routeId: string,
  day: number
): Promise<unknown> => {
  const key = `${routeId}:${day}`;
  // pg_advisory_xact_lock returns void, which the pg driver adapter cannot
  // decode as a $queryRaw result column (P2010/UnsupportedNativeDataType).
  // $executeRaw only reports the affected-row count, so it sidesteps that.
  return client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
};

/** Vacates a day with no replacement vendor — the symmetric operation to createRouteAssignment. */
export const unassignRouteDay = async (
  client: Client,
  routeId: string,
  day: number
): Promise<void> => {
  const current = await getActiveAssignmentForDay(client, routeId, day);
  if (!current) throw CustomError.notFound('No active assignment for this day');

  await softDeleteRouteAssignment(client, current.id);
};

export const softDeleteRouteAssignment = (
  client: Client,
  assignmentId: string
): Promise<void> => {
  const now = new Date();
  return client.route_user
    .update({
      where: { id: assignmentId },
      data: { deleted_at: now, updated_at: now },
    })
    .then(() => undefined);
};
