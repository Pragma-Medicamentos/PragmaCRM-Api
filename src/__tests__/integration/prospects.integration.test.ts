import request from 'supertest';
import { verifyAccessToken } from '../../lib/supabaseJwt';
import { prisma } from '../../lib/prisma';
import { AppRoutes } from '../../presentation/routes';
import { Server } from '../../presentation/server';
import { envs } from '../../config/envs';
import { ROLES } from '../../domain/types/auth.types';

/**
 * PCRM-185 against real Postgres: the sanitary registration, NRC, NIT and
 * email columns are written on create (seller and admin), read back by the
 * list, and edited partially by PATCH /:id. Runs on the local Supabase
 * database (loadEnv.ts forces .env.test). Token verification is mocked.
 */

jest.mock('../../lib/supabaseJwt', () => ({
  verifyAccessToken: jest.fn(),
  JwksUnavailableError: class extends Error {},
  warmUpJwks: jest.fn(),
}));

const verifyAccessTokenMock = verifyAccessToken as unknown as jest.Mock;

const ADMIN_AUTH_ID = 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1';
const SELLER_AUTH_ID = 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2';
const HEADERS = { 'x-api-key': envs.API_KEY, Authorization: 'Bearer test' };

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

let adminId: string;
let sellerId: string;
const createdIds: string[] = [];

const as = (authId: string) =>
  verifyAccessTokenMock.mockResolvedValue({ sub: authId });

const stored = (id: string) =>
  prisma.prospect.findUniqueOrThrow({
    where: { id },
    select: {
      name: true,
      phone: true,
      sanitary_registration: true,
      nrc: true,
      nit: true,
      email: true,
    },
  });

const createUser = async (authId: string, role: string, email: string) => {
  await prisma.$executeRaw`
    insert into auth.users (id, instance_id, aud, role, email)
    values (
      ${authId}::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'authenticated', 'authenticated', ${email}
    )
    on conflict (id) do nothing`;

  return (
    await prisma.app_user.create({
      data: { auth_user_id: authId, role, name: email, email, active: true },
    })
  ).id;
};

beforeAll(async () => {
  adminId = await createUser(ADMIN_AUTH_ID, ROLES.ADMIN, 'prospects-admin@pragma.test');
  sellerId = await createUser(SELLER_AUTH_ID, ROLES.SELLER, 'prospects-seller@pragma.test');
});

afterAll(async () => {
  for (const id of createdIds) {
    await prisma.$executeRaw`delete from prospect where id = ${id}::uuid`;
  }
  await prisma.$executeRaw`delete from app_user where id in (${adminId}::uuid, ${sellerId}::uuid)`;
  await prisma.$executeRaw`delete from auth.users where id in (${ADMIN_AUTH_ID}::uuid, ${SELLER_AUTH_ID}::uuid)`;
  await prisma.$disconnect();
});

describe('PCRM-185: prospect fiscal fields', () => {
  let prospectId: string;

  it('stores them when the seller registers a prospect', async () => {
    as(SELLER_AUTH_ID);

    const res = await request(app)
      .post('/api/v1/prospects')
      .set(HEADERS)
      .send({
        name: 'Farmacia Fiscal',
        phone: '7777-0185',
        latitude: 13.7,
        longitude: -89.2,
        captured_at: '2026-10-16T10:00:00-06:00',
        sanitary_registration: 'RS-0185',
        nrc: '230204-4',
        nit: '01234567-8',
        email: 'Compras@Fiscal.com',
      });

    expect(res.status).toBe(201);
    prospectId = res.body.data.id;
    createdIds.push(prospectId);
    expect(res.body.data).toMatchObject({
      sanitary_registration: 'RS-0185',
      nrc: '230204-4',
      nit: '01234567-8',
      email: 'compras@fiscal.com',
    });
    expect(await stored(prospectId)).toMatchObject({
      nrc: '230204-4',
      email: 'compras@fiscal.com',
    });
  });

  it('returns them in the admin list', async () => {
    as(ADMIN_AUTH_ID);

    const res = await request(app)
      .get('/api/v1/prospects')
      .query({ user_id: sellerId })
      .set(HEADERS);

    expect(res.status).toBe(200);
    const item = res.body.data.items.find(
      (p: { id: string }) => p.id === prospectId
    );
    expect(item).toMatchObject({ nit: '01234567-8', sanitary_registration: 'RS-0185' });
  });

  it('edits one field and leaves the rest untouched', async () => {
    as(ADMIN_AUTH_ID);

    const res = await request(app)
      .patch(`/api/v1/prospects/${prospectId}`)
      .set(HEADERS)
      .send({ nit: '0614-250621-108-6' });

    expect(res.status).toBe(200);
    expect(await stored(prospectId)).toEqual({
      name: 'Farmacia Fiscal',
      phone: '7777-0185',
      sanitary_registration: 'RS-0185',
      nrc: '230204-4',
      nit: '0614-250621-108-6',
      email: 'compras@fiscal.com',
    });
  });

  it('clears a field with null and accepts a blank string as null', async () => {
    as(ADMIN_AUTH_ID);

    const res = await request(app)
      .patch(`/api/v1/prospects/${prospectId}`)
      .set(HEADERS)
      .send({ email: null, nrc: '' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ email: null, nrc: null });
    expect(await stored(prospectId)).toMatchObject({ email: null, nrc: null });
  });

  it('stores them on the admin create, and leaves them null when omitted', async () => {
    as(ADMIN_AUTH_ID);

    const withFields = await request(app)
      .post('/api/v1/prospects/admin')
      .set(HEADERS)
      .send({ user_id: sellerId, name: 'Con datos', phone: '2222-0185', nrc: '1234-5' });
    const without = await request(app)
      .post('/api/v1/prospects/admin')
      .set(HEADERS)
      .send({ user_id: sellerId, name: 'Sin datos', phone: '2222-0186' });

    expect(withFields.status).toBe(201);
    expect(without.status).toBe(201);
    createdIds.push(withFields.body.data.id, without.body.data.id);
    expect(withFields.body.data.nrc).toBe('1234-5');
    expect(await stored(without.body.data.id)).toMatchObject({
      sanitary_registration: null,
      nrc: null,
      nit: null,
      email: null,
    });
  });

  it('answers 404 for a soft-deleted prospect', async () => {
    as(ADMIN_AUTH_ID);
    const deleted = await prisma.prospect.create({
      data: { user_id: sellerId, name: 'Borrado', deleted_at: new Date() },
    });
    createdIds.push(deleted.id);

    const res = await request(app)
      .patch(`/api/v1/prospects/${deleted.id}`)
      .set(HEADERS)
      .send({ nrc: '230204-4' });

    expect(res.status).toBe(404);
    expect((await stored(deleted.id)).nrc).toBeNull();
  });

  it('forbids the seller from editing', async () => {
    as(SELLER_AUTH_ID);

    const res = await request(app)
      .patch(`/api/v1/prospects/${prospectId}`)
      .set(HEADERS)
      .send({ nrc: '230204-4' });

    expect(res.status).toBe(403);
    expect((await stored(prospectId)).nrc).toBeNull();
  });
});
