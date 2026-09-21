import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { envs } from '../config/envs';

// Since Prisma 7 the connection is not declared in schema.prisma: it is
// injected through an adapter. PrismaPg uses the `pg` driver directly.
//
// Read through envs so a missing DATABASE_URL aborts the boot instead of
// producing the literal string "undefined" as a connection string.
const adapter = new PrismaPg({
  connectionString: envs.DATABASE_URL,

  // Each container holds its own pool, so this is a per-replica budget against
  // whatever the Supabase pooler allows. `pg` defaults to 10 silently; stating
  // it keeps the ceiling visible when a second replica is added.
  max: 10,

  // Fail a request that cannot get a connection instead of queueing it until
  // the client gives up with no trace on the server.
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
});
const prisma = new PrismaClient({ adapter });

// Inside a transaction Prisma hands over a different client (without
// $transaction or $connect). Services take `Client` so the same function can
// run standalone or inside a $transaction without duplicating its signature.
type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
export type Client = typeof prisma | TxClient;

export { prisma };
