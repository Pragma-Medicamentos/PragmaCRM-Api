import request from 'supertest';
import { verifyAccessToken } from '../../lib/supabaseJwt';
import { prisma } from '../../lib/prisma';
import { AppRoutes } from '../../presentation/routes';
import { Server } from '../../presentation/server';
import { envs } from '../../config/envs';
import { ROLES } from '../../domain/types/auth.types';

/**
 * Customer commercial profile (RF-12) against real Postgres: the partial
 * update, and the customer_personality_check / customer_potential_check
 * constraints that guard the supabase-js path the API never sees. Runs on the
 * local Supabase database (loadEnv.ts forces .env.test). Token verification
 * is mocked.
 */

jest.mock('../../lib/supabaseJwt', () => ({
  verifyAccessToken: jest.fn(),
  JwksUnavailableError: class extends Error {},
  warmUpJwks: jest.fn(),
}));

const verifyAccessTokenMock = verifyAccessToken as unknown as jest.Mock;

const ADMIN_AUTH_ID = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1';
const HEADERS = { 'x-api-key': envs.API_KEY, Authorization: 'Bearer test' };

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

let adminId: string;
let customerId: string;

const patch = (id: string, body: Record<string, unknown>) =>
  request(app)
    .patch(`/api/v1/customers/${id}/commercial-profile`)
    .set(HEADERS)
    .send(body);

const stored = () =>
  prisma.customer.findUniqueOrThrow({
    where: { id: customerId },
    select: { personality: true, potential: true, updated_at: true },
  });

beforeAll(async () => {
  await prisma.$executeRaw`
    insert into auth.users (id, instance_id, aud, role, email)
    values (
      ${ADMIN_AUTH_ID}::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'authenticated', 'authenticated', 'customers-admin@pragma.test'
    )
    on conflict (id) do nothing`;

  adminId = (
    await prisma.app_user.create({
      data: {
        auth_user_id: ADMIN_AUTH_ID,
        role: ROLES.ADMIN,
        name: 'Customers Test Admin',
        email: 'customers-admin@pragma.test',
        active: true,
      },
    })
  ).id;

  customerId = (
    await prisma.customer.create({ data: { name: 'Commercial Profile Test Customer' } })
  ).id;
});

beforeEach(() => {
  verifyAccessTokenMock.mockResolvedValue({ sub: ADMIN_AUTH_ID });
});

afterAll(async () => {
  await prisma.$executeRaw`delete from customer where id = ${customerId}::uuid`;
  await prisma.$executeRaw`delete from app_user where id = ${adminId}::uuid`;
  await prisma.$executeRaw`delete from auth.users where id = ${ADMIN_AUTH_ID}::uuid`;
  await prisma.$disconnect();
});

describe('PATCH /api/v1/customers/:id/commercial-profile', () => {
  it('saves colour and potential and answers with the customer core', async () => {
    const before = await stored();

    const res = await patch(customerId, { personality: 'rojo', potential: 'alto' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: customerId,
      personality: 'rojo',
      potential: 'alto',
    });
    const after = await stored();
    expect(after).toMatchObject({ personality: 'rojo', potential: 'alto' });
    expect(after.updated_at.getTime()).toBeGreaterThanOrEqual(
      before.updated_at.getTime()
    );
  });

  it('changes only the field it receives', async () => {
    const res = await patch(customerId, { potential: 'bajo' });

    expect(res.status).toBe(200);
    expect(await stored()).toMatchObject({ personality: 'rojo', potential: 'bajo' });
  });

  it('clears a field sent as null', async () => {
    const res = await patch(customerId, { personality: null });

    expect(res.status).toBe(200);
    expect(res.body.data.personality).toBeNull();
    expect(await stored()).toMatchObject({ personality: null, potential: 'bajo' });
  });

  it('answers 404 for a soft-deleted customer and leaves it untouched', async () => {
    const deleted = await prisma.customer.create({
      data: { name: 'Deleted Commercial Profile Customer', deleted_at: new Date() },
    });

    try {
      const res = await patch(deleted.id, { personality: 'verde' });

      expect(res.status).toBe(404);
      const row = await prisma.customer.findUniqueOrThrow({
        where: { id: deleted.id },
        select: { personality: true },
      });
      expect(row.personality).toBeNull();
    } finally {
      await prisma.$executeRaw`delete from customer where id = ${deleted.id}::uuid`;
    }
  });

  it('is closed to sellers', async () => {
    const sellerAuthId = 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2';
    await prisma.$executeRaw`
      insert into auth.users (id, instance_id, aud, role, email)
      values (
        ${sellerAuthId}::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid,
        'authenticated', 'authenticated', 'customers-seller@pragma.test'
      )
      on conflict (id) do nothing`;
    const seller = await prisma.app_user.create({
      data: {
        auth_user_id: sellerAuthId,
        role: ROLES.SELLER,
        name: 'Customers Test Seller',
        email: 'customers-seller@pragma.test',
        active: true,
      },
    });

    try {
      verifyAccessTokenMock.mockResolvedValue({ sub: sellerAuthId });
      const res = await patch(customerId, { personality: 'azul' });

      expect(res.status).toBe(403);
      expect((await stored()).personality).toBeNull();
    } finally {
      await prisma.$executeRaw`delete from app_user where id = ${seller.id}::uuid`;
      await prisma.$executeRaw`delete from auth.users where id = ${sellerAuthId}::uuid`;
    }
  });
});

describe('customer RF-12 constraints', () => {
  // The dashboard can also write these columns straight through supabase-js
  // (customer_update_admin), where Zod does not run.
  it.each([
    ['personality', 'Rojo'],
    ['personality', 'morado'],
    ['potential', 'alta'],
  ])('rejects %s = %s written outside the API', async (column, value) => {
    await expect(
      prisma.customer.update({
        where: { id: customerId },
        data: { [column]: value },
      })
    ).rejects.toThrow(/customer_(personality|potential)_check/);
  });
});
