import { Prisma } from '../generated/prisma/client';
import { Client } from '../lib/prisma';

/**
 * Whether the customer has a GPS pin.
 *
 * `customer.location` is Unsupported("geography") in Prisma and dropped from
 * the typed client entirely, so an `IS NULL` check on it has to go through
 * $queryRaw even though the rest of extra-stop.service.ts reads the typed
 * API. Caller is expected to have already asserted the customer exists.
 */
export const customerHasGps = async (
  client: Client,
  customerId: string
): Promise<boolean> => {
  const rows = await client.$queryRaw<{ has_gps: boolean }[]>(Prisma.sql`
    SELECT (location IS NOT NULL) AS has_gps
    FROM   customer
    WHERE  id = ${customerId}::uuid
  `);

  return rows[0]?.has_gps ?? false;
};
