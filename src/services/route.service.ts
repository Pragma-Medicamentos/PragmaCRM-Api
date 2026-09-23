import { Prisma } from '../generated/prisma/client';
import { Client } from '../lib/prisma';
import { CustomError } from '../domain/errors/CustomError';
import { ROLES } from '../domain/types/auth.types';
import {
  CreateRouteInput,
  CreateRouteStopInput,
  StopType,
  UpdateRouteInput,
  UpdateRouteStopInput,
} from '../domain/schemas/route.schema';

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

export interface RouteStopRecord {
  id: string;
  route_id: string;
  customer_id: string;
  customer_name: string | null;
  sort_order: number | null;
  stop_type: string;
  location: { lat: number; lng: number } | null;
  created_at: Date;
  updated_at: Date;
}

// customer.location is a PostGIS geography column; Prisma marks it
// Unsupported and drops it from the generated client entirely, so it cannot
// be selected here. has_gps is left out rather than faked.
const ROUTE_STOP_SELECT = {
  id: true,
  route_id: true,
  customer_id: true,
  sort_order: true,
  stop_type: true,
  created_at: true,
  updated_at: true,
  customer: { select: { name: true } },
} as const;

type RouteStopRow = {
  id: string;
  route_id: string;
  customer_id: string;
  sort_order: number | null;
  stop_type: string;
  created_at: Date;
  updated_at: Date;
  customer: { name: string };
};

type LocationMap = Map<string, { lat: number; lng: number } | null>;

const toRouteStopRecord = (row: RouteStopRow, locations: LocationMap): RouteStopRecord => ({
  id: row.id,
  route_id: row.route_id,
  customer_id: row.customer_id,
  customer_name: row.customer.name,
  sort_order: row.sort_order,
  stop_type: row.stop_type,
  location: locations.get(row.customer_id) || null,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const enrichRouteStopsWithLocation = async (
  client: Client,
  rows: RouteStopRow[]
): Promise<LocationMap> => {
  if (rows.length === 0) return new Map();

  const customerIds = rows.map((r) => r.customer_id);
  const results = await client.$queryRaw<{ customer_id: string; lat: number | null; lng: number | null }[]>(
    Prisma.sql`
      SELECT c.id::text AS customer_id,
             extensions.st_y(c.location::extensions.geometry)::float8 AS lat,
             extensions.st_x(c.location::extensions.geometry)::float8 AS lng
      FROM   customer c
      WHERE  c.id = ANY(${customerIds}::uuid[])
        AND  c.deleted_at IS NULL
    `
  );

  const map = new Map<string, { lat: number; lng: number } | null>();
  results.forEach((row) => {
    map.set(row.customer_id, row.lat !== null && row.lng !== null ? { lat: row.lat, lng: row.lng } : null);
  });

  customerIds.forEach((id) => {
    if (!map.has(id)) map.set(id, null);
  });

  return map;
};

/** Active (non soft-deleted) stops for a route, planning order first (RF-04). */
export const listRouteStops = async (
  client: Client,
  routeId: string
): Promise<RouteStopRecord[]> => {
  const rows = await client.route_customer.findMany({
    where: { route_id: routeId, deleted_at: null },
    select: ROUTE_STOP_SELECT,
    orderBy: [{ sort_order: { sort: 'asc', nulls: 'last' } }, { created_at: 'asc' }],
  });

  const typedRows = rows as unknown as RouteStopRow[];
  const locations = await enrichRouteStopsWithLocation(client, typedRows);

  return typedRows.map((row) => toRouteStopRecord(row, locations));
};

export const getActiveRouteStop = (
  client: Client,
  routeId: string,
  stopId: string
): Promise<{ id: string } | null> =>
  client.route_customer.findFirst({
    where: { id: stopId, route_id: routeId, deleted_at: null },
    select: { id: true },
  });

const assertActiveCustomer = async (client: Client, customerId: string): Promise<void> => {
  const customer = await client.customer.findFirst({
    where: { id: customerId, deleted_at: null },
    select: { id: true },
  });

  if (!customer) throw CustomError.notFound('Customer not found');
};

const nextSortOrder = async (client: Client, routeId: string): Promise<number> => {
  const top = await client.route_customer.findFirst({
    where: { route_id: routeId, deleted_at: null },
    select: { sort_order: true },
    orderBy: { sort_order: 'desc' },
  });

  return (top?.sort_order ?? 0) + 1;
};

/**
 * Adds a customer to a route package (planning only — RF-04). GPS is never
 * checked here: composing the route is not the same as executing it
 * (CLAUDE.md 5.1). A soft-deleted stop for the same (route, customer) is
 * revived instead of duplicated, since the unique key only covers active rows.
 */
export const addRouteStop = async (
  client: Client,
  routeId: string,
  data: CreateRouteStopInput
): Promise<RouteStopRecord> => {
  await getRouteById(client, routeId);
  await assertActiveCustomer(client, data.customer_id);

  const stopType: StopType = data.stop_type ?? 'visit';

  const existing = await client.route_customer.findFirst({
    where: { route_id: routeId, customer_id: data.customer_id },
    select: { id: true, deleted_at: true },
  });

  if (existing && !existing.deleted_at) {
    throw CustomError.conflict('Customer is already a stop on this route');
  }

  const sortOrder = data.sort_order ?? (await nextSortOrder(client, routeId));

  const row = existing
    ? await client.route_customer.update({
        where: { id: existing.id },
        data: {
          stop_type: stopType,
          sort_order: sortOrder,
          deleted_at: null,
          updated_at: new Date(),
        },
        select: ROUTE_STOP_SELECT,
      })
    : await client.route_customer.create({
        data: {
          route_id: routeId,
          customer_id: data.customer_id,
          stop_type: stopType,
          sort_order: sortOrder,
        },
        select: ROUTE_STOP_SELECT,
      });

  const locations = await enrichRouteStopsWithLocation(client, [row as unknown as RouteStopRow]);
  return toRouteStopRecord(row as unknown as RouteStopRow, locations);
};

export const updateRouteStop = async (
  client: Client,
  routeId: string,
  stopId: string,
  data: UpdateRouteStopInput
): Promise<RouteStopRecord> => {
  const stop = await getActiveRouteStop(client, routeId, stopId);
  if (!stop) throw CustomError.notFound('Stop not found');

  const row = await client.route_customer.update({
    where: { id: stopId },
    data: {
      ...(data.stop_type !== undefined ? { stop_type: data.stop_type } : {}),
      ...(data.sort_order !== undefined ? { sort_order: data.sort_order } : {}),
      updated_at: new Date(),
    },
    select: ROUTE_STOP_SELECT,
  });

  const locations = await enrichRouteStopsWithLocation(client, [row as unknown as RouteStopRow]);
  return toRouteStopRecord(row as unknown as RouteStopRow, locations);
};

export const softDeleteRouteStop = async (
  client: Client,
  routeId: string,
  stopId: string
): Promise<void> => {
  const stop = await getActiveRouteStop(client, routeId, stopId);
  if (!stop) throw CustomError.notFound('Stop not found');

  const now = new Date();
  await client.route_customer.update({
    where: { id: stopId },
    data: { deleted_at: now, updated_at: now },
  });
};

/** Guards a reorder request: the submitted id set must match the route's current active stops exactly. */
export const assertReorderCoversActiveStops = async (
  client: Client,
  routeId: string,
  stopIds: string[]
): Promise<void> => {
  const current = await client.route_customer.findMany({
    where: { route_id: routeId, deleted_at: null },
    select: { id: true },
  });

  const currentIds = new Set(current.map((row) => row.id));
  const submittedIds = new Set(stopIds);

  if (
    currentIds.size !== submittedIds.size ||
    ![...currentIds].every((id) => submittedIds.has(id))
  ) {
    throw CustomError.badRequest("stop_ids must match the route's current active stops exactly");
  }
};

export const applyRouteStopOrder = (
  client: Client,
  stopIds: string[]
): Promise<unknown> =>
  Promise.all(
    stopIds.map((id, index) =>
      client.route_customer.update({
        where: { id },
        data: { sort_order: index + 1, updated_at: new Date() },
      })
    )
  );

export interface ReplaceRouteStopsInput {
  stops: Array<{
    customer_id: string;
    stop_type?: string;
    sort_order?: number;
  }>;
}

/**
 * Replace all route stops with the provided set (Web PCRM-141 contract).
 * - Soft-deletes all current stops not in the new set.
 * - Creates or revives stops for each item in the new set.
 * - Sets sort_order sequentially if not provided.
 * - Rejects duplicate customer_id and missing customer with 400/404.
 */
export const replaceRouteStops = async (
  client: Client,
  routeId: string,
  input: ReplaceRouteStopsInput
): Promise<RouteStopRecord[]> => {
  await getRouteById(client, routeId);

  const stops = input.stops;

  // Reject duplicate customer_id in the request
  const customerIds = stops.map((s) => s.customer_id);
  const uniqueIds = new Set(customerIds);
  if (uniqueIds.size !== customerIds.length) {
    throw CustomError.badRequest('Duplicate customer_id in stops');
  }

  // Validate all customers exist
  if (stops.length > 0) {
    const existing = await client.customer.findMany({
      where: {
        id: { in: customerIds },
        deleted_at: null,
      },
      select: { id: true },
    });
    if (existing.length !== stops.length) {
      throw CustomError.notFound('One or more customers not found');
    }
  }

  // Soft-delete active stops not in the new set
  const currentStops = await client.route_customer.findMany({
    where: { route_id: routeId, deleted_at: null },
    select: { id: true, customer_id: true },
  });

  const newCustomerIds = new Set(customerIds);
  const toDelete = currentStops.filter((s) => !newCustomerIds.has(s.customer_id));
  const now = new Date();

  if (toDelete.length > 0) {
    await Promise.all(
      toDelete.map((s) =>
        client.route_customer.update({
          where: { id: s.id },
          data: { deleted_at: now, updated_at: now },
        })
      )
    );
  }

  // Upsert stops from the new set
  for (let index = 0; index < stops.length; index++) {
    const item = stops[index];
    const stopType: StopType = item.stop_type ? (item.stop_type as StopType) : 'visit';
    const sortOrder = item.sort_order !== undefined ? item.sort_order : index + 1;

    const existing = await client.route_customer.findFirst({
      where: { route_id: routeId, customer_id: item.customer_id },
      select: { id: true, deleted_at: true },
    });

    if (existing && !existing.deleted_at) {
      // Already active, update
      await client.route_customer.update({
        where: { id: existing.id },
        data: {
          stop_type: stopType,
          sort_order: sortOrder,
          updated_at: now,
        },
      });
    } else if (existing && existing.deleted_at) {
      // Soft-deleted, revive and update
      await client.route_customer.update({
        where: { id: existing.id },
        data: {
          stop_type: stopType,
          sort_order: sortOrder,
          deleted_at: null,
          updated_at: now,
        },
      });
    } else {
      // Create new
      await client.route_customer.create({
        data: {
          route_id: routeId,
          customer_id: item.customer_id,
          stop_type: stopType,
          sort_order: sortOrder,
        },
      });
    }
  }

  // Return updated list
  return listRouteStops(client, routeId);
};
