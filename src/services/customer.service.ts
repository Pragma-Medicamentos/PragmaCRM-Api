import { Client } from '../lib/prisma';
import { CustomError } from '../domain/errors/CustomError';
import { UpdateCustomerLocationInput } from '../domain/schemas/customer.schema';

export interface CustomerLocation {
  latitude: number;
  longitude: number;
}

export interface CustomerRecord {
  id: string;
  name: string;
  active: boolean;
  location: CustomerLocation | null;
  updated_at: Date;
}

const findActiveCustomer = async (
  client: Client,
  id: string
): Promise<CustomerRecord> => {
  const rows = await client.$queryRaw<
    Array<{
      id: string;
      name: string;
      active: boolean;
      longitude: number | null;
      latitude: number | null;
      updated_at: Date;
    }>
  >`
    SELECT
      id,
      name,
      active,
      extensions.ST_X(location::extensions.geometry) AS longitude,
      extensions.ST_Y(location::extensions.geometry) AS latitude,
      updated_at
    FROM customer
    WHERE id = ${id}::uuid AND deleted_at IS NULL
  `;

  const row = rows[0];
  if (!row) throw CustomError.notFound('Cliente no encontrado');

  return {
    id: row.id,
    name: row.name,
    active: row.active,
    location:
      row.latitude !== null && row.longitude !== null
        ? { latitude: row.latitude, longitude: row.longitude }
        : null,
    updated_at: row.updated_at,
  };
};

export const getCustomerById = (
  client: Client,
  id: string
): Promise<CustomerRecord> => findActiveCustomer(client, id);

export const updateCustomerLocation = async (
  client: Client,
  id: string,
  data: UpdateCustomerLocationInput
): Promise<CustomerRecord> => {
  await findActiveCustomer(client, id);

  await client.$executeRaw`
    UPDATE customer
    SET
      location = extensions.ST_SetSRID(
        extensions.ST_MakePoint(${data.longitude}, ${data.latitude}),
        4326
      )::extensions.geography,
      updated_at = now()
    WHERE id = ${id}::uuid AND deleted_at IS NULL
  `;

  return findActiveCustomer(client, id);
};
