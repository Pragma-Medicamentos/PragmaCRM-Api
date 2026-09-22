import { Prisma } from '../generated/prisma/client';
import { Client } from '../lib/prisma';
import {
  CreateProspectInput,
  ListProspectsQuery,
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
 *      POST /api/v1/prospects -> createProspect
 *      GET  /api/v1/prospects -> listProspects
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
