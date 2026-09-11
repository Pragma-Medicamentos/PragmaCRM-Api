import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

// Since Prisma 7 the connection is not declared in schema.prisma: it is
// injected through an adapter. PrismaPg uses the `pg` driver directly.
const connectionString = `${process.env.DATABASE_URL}`;

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

// Inside a transaction Prisma hands over a different client (without
// $transaction or $connect). Services take `Client` so the same function can
// run standalone or inside a $transaction without duplicating its signature.
type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
export type Client = typeof prisma | TxClient;

export { prisma };
