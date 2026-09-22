import { Client } from '../lib/prisma';
import { CreateProspectInput } from '../domain/schemas/prospect.schema';
import { CreatedProspect } from '../domain/types/prospect.types';

/*
 * ============================================================================
 * 1. MAIN METHODS — called directly by ProspectsController, one per route:
 *
 *      POST /api/v1/prospects -> createProspect
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
