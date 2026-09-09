import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

// Desde Prisma 7 la conexion no se declara en schema.prisma: se inyecta con un
// adapter. PrismaPg usa el driver `pg` directamente.
const connectionString = `${process.env.DATABASE_URL}`;

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

// Dentro de una transaccion, Prisma entrega un cliente distinto (sin $transaction
// ni $connect). Los services reciben `Client` para poder correr igual sueltos o
// dentro de un $transaction, sin duplicar la firma.
type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
export type Client = typeof prisma | TxClient;

export { prisma };
