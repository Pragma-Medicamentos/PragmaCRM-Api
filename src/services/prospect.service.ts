import { Prisma } from '../generated/prisma/client';
import { Client } from '../lib/prisma';
import { CustomError } from '../domain/errors/CustomError';
import { ROLES } from '../domain/types/auth.types';
import {
  CreateProspectAdminInput,
  CreateProspectInput,
  ListProspectsQuery,
  UpdateProspectLocationInput,
} from '../domain/schemas/prospect.schema';
import {
  CreatedProspect,
  ProspectListItem,
} from '../domain/types/prospect.types';
import { Paginated, buildPage } from '../domain/types/pagination.types';

/*
 * ============================================================================
 * 1. MAIN METHODS — called directly by ProspectsController, one per route:
 *
 *      POST  /api/v1/prospects           -> createProspect
 *      GET   /api/v1/prospects           -> listProspects
 *      POST  /api/v1/prospects/admin     -> createProspectAsAdmin
 *      PATCH /api/v1/prospects/:id/location -> updateProspectLocation
 * ============================================================================
 */

/**
 * PCRM-62: register a prospect with name, phone, GPS and device timestamp.
 *
 * Prisma cannot write Unsupported("geography"), so the row is created first
 * and `location` is set with the same PostGIS pattern as customers/visits.
 * `captured_at` is not persisted (no column); callers echo it from the input.
 */
export const createProspect = async (
  client: Client,
  sellerId: string,
  input: CreateProspectInput
): Promise<CreatedProspect> => {
  const row = await client.prospect.create({
    data: {
      user_id: sellerId,
      name: input.name,
      phone: input.phone,
    },
    select: {
      id: true,
      name: true,
      phone: true,
      user_id: true,
      created_at: true,
      status: true,
    },
  });

  await client.$executeRaw`
    UPDATE prospect
    SET
      location = extensions.ST_SetSRID(
        extensions.ST_MakePoint(${input.longitude}, ${input.latitude}),
        4326
      )::extensions.geography,
      updated_at = now()
    WHERE id = ${row.id}::uuid AND deleted_at IS NULL
  `;

  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    user_id: row.user_id,
    location: { lat: input.latitude, lng: input.longitude },
    created_at: row.created_at.toISOString(),
    captured_at: input.captured_at.toISOString(),
    status: row.status,
  };
};

/**
 * PCRM-62 / PCRM-64: paginated prospect list for the admin web.
 *
 * Soft-deleted rows are excluded. Optional `user_id` filters by seller.
 * Location is read via PostGIS because Prisma cannot select Unsupported geography.
 * `seller_name` comes from a join to `app_user` so the web list can show who
 * registered each prospect without a second round-trip.
 */
export const listProspects = async (
  client: Client,
  query: ListProspectsQuery
): Promise<Paginated<ProspectListItem>> => {
  const offset = (query.page - 1) * query.limit;
  const sellerFilter = query.user_id
    ? Prisma.sql`AND p.user_id = ${query.user_id}::uuid`
    : Prisma.empty;

  type Row = {
    id: string;
    name: string;
    phone: string | null;
    user_id: string;
    seller_name: string;
    lat: number | null;
    lng: number | null;
    created_at: Date;
    status: string | null;
    total_count: bigint;
  };

  const rows = await client.$queryRaw<Row[]>`
    SELECT
      p.id,
      p.name,
      p.phone,
      p.user_id,
      u.name AS seller_name,
      extensions.st_y(p.location::extensions.geometry)::float8 AS lat,
      extensions.st_x(p.location::extensions.geometry)::float8 AS lng,
      p.created_at,
      p.status,
      COUNT(*) OVER()::bigint AS total_count
    FROM prospect p
    INNER JOIN app_user u ON u.id = p.user_id
    WHERE p.deleted_at IS NULL
      ${sellerFilter}
    ORDER BY p.created_at DESC
    LIMIT ${query.limit} OFFSET ${offset}
  `;

  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
  const items: ProspectListItem[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    user_id: row.user_id,
    seller_name: row.seller_name,
    location:
      row.lat !== null && row.lng !== null
        ? { lat: row.lat, lng: row.lng }
        : null,
    created_at: row.created_at.toISOString(),
    status: row.status,
  }));

  return buildPage(items, total, query.page, query.limit);
};

/**
 * Single-row projection shared by createProspectAsAdmin and
 * updateProspectLocation, same shape (and PostGIS lat/lng trick) as the list
 * above so the admin web can render the result without a second round-trip.
 */
export const getProspectById = async (
  client: Client,
  id: string
): Promise<ProspectListItem> => {
  type Row = {
    id: string;
    name: string;
    phone: string | null;
    user_id: string;
    seller_name: string;
    lat: number | null;
    lng: number | null;
    created_at: Date;
    status: string | null;
  };

  const rows = await client.$queryRaw<Row[]>`
    SELECT
      p.id,
      p.name,
      p.phone,
      p.user_id,
      u.name AS seller_name,
      extensions.st_y(p.location::extensions.geometry)::float8 AS lat,
      extensions.st_x(p.location::extensions.geometry)::float8 AS lng,
      p.created_at,
      p.status
    FROM prospect p
    INNER JOIN app_user u ON u.id = p.user_id
    WHERE p.id = ${id}::uuid AND p.deleted_at IS NULL
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) throw CustomError.notFound('Prospect not found');

  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    user_id: row.user_id,
    seller_name: row.seller_name,
    location:
      row.lat !== null && row.lng !== null
        ? { lat: row.lat, lng: row.lng }
        : null,
    created_at: row.created_at.toISOString(),
    status: row.status,
  };
};

/**
 * Guards createProspectAsAdmin against attributing a prospect to an
 * Administrador or to a disabled/soft-deleted Vendedor. Mirrors
 * assertActiveSeller in route.service.ts — duplicated rather than shared
 * across services, same as that module.
 */
const assertActiveSeller = async (
  client: Client,
  userId: string
): Promise<void> => {
  const seller = await client.app_user.findFirst({
    where: { id: userId, deleted_at: null },
    select: { role: true, active: true },
  });

  if (!seller) throw CustomError.notFound('Seller not found');
  if (seller.role !== ROLES.SELLER) {
    throw CustomError.badRequest('User is not a Vendedor');
  }
  if (!seller.active) throw CustomError.badRequest('Seller is not active');
};

/**
 * PCRM-64: admin registers a prospect on behalf of a seller. GPS is optional
 * (see createProspectAdminSchema) — omitted, the row is created without a
 * location and updateProspectLocation fills it in later.
 */
export const createProspectAsAdmin = async (
  client: Client,
  input: CreateProspectAdminInput
): Promise<ProspectListItem> => {
  await assertActiveSeller(client, input.user_id);

  const row = await client.prospect.create({
    data: {
      user_id: input.user_id,
      name: input.name,
      phone: input.phone,
    },
    select: { id: true },
  });

  if (input.latitude !== undefined && input.longitude !== undefined) {
    await client.$executeRaw`
      UPDATE prospect
      SET
        location = extensions.ST_SetSRID(
          extensions.ST_MakePoint(${input.longitude}, ${input.latitude}),
          4326
        )::extensions.geography,
        updated_at = now()
      WHERE id = ${row.id}::uuid AND deleted_at IS NULL
    `;
  }

  return getProspectById(client, row.id);
};

/** PCRM-64: set or correct a prospect's GPS pin after creation. */
export const updateProspectLocation = async (
  client: Client,
  id: string,
  data: UpdateProspectLocationInput
): Promise<ProspectListItem> => {
  await getProspectById(client, id);

  await client.$executeRaw`
    UPDATE prospect
    SET
      location = extensions.ST_SetSRID(
        extensions.ST_MakePoint(${data.longitude}, ${data.latitude}),
        4326
      )::extensions.geography,
      updated_at = now()
    WHERE id = ${id}::uuid AND deleted_at IS NULL
  `;

  return getProspectById(client, id);
};
