import request from 'supertest';
import { verifyAccessToken } from '../../lib/supabaseJwt';
import { prisma } from '../../lib/prisma';
import { localToday } from '../../lib/localDateRange';
import { AppRoutes } from '../../presentation/routes';
import { Server } from '../../presentation/server';
import { envs } from '../../config/envs';
import { ROLES } from '../../domain/types/auth.types';

/**
 * PCRM-186 against real Postgres: POST /api/v1/prospects/:id/convert links by
 * public.normalize_name, deactivates the prospect, moves only its pending
 * stops, and answers a coded 409 for every case it does not link. Runs on the
 * local Supabase database (loadEnv.ts forces .env.test). Token verification is
 * mocked.
 */

jest.mock('../../lib/supabaseJwt', () => ({
  verifyAccessToken: jest.fn(),
  JwksUnavailableError: class extends Error {},
  warmUpJwks: jest.fn(),
}));

const verifyAccessTokenMock = verifyAccessToken as unknown as jest.Mock;

const ADMIN_AUTH_ID = 'f6f6f6f6-f6f6-4f6f-8f6f-f6f6f6f6f6f6';
const SELLER_AUTH_ID = 'f7f7f7f7-f7f7-4f7f-8f7f-f7f7f7f7f7f7';
const HEADERS = { 'x-api-key': envs.API_KEY, Authorization: 'Bearer test' };
const ERP_IDS = [98_861, 98_862, 98_863];

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

let adminId: string;
let sellerId: string;
let routeId: string;
let routeUserId: string;
let matchCustomerId: string;
const prospects: Record<string, string> = {};

const convert = (id: string) =>
  request(app).post(`/api/v1/prospects/${id}/convert`).set(HEADERS);

const addDays = (day: string, days: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return new Date(d.toISOString().slice(0, 10));
};

const createUser = async (authId: string, role: string, email: string) => {
  await prisma.$executeRaw`
    insert into auth.users (id, instance_id, aud, role, email)
    values (${authId}::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
            'authenticated', 'authenticated', ${email})
    on conflict (id) do nothing`;
  return (
    await prisma.app_user.create({
      data: { auth_user_id: authId, role, name: email, email, active: true },
    })
  ).id;
};

beforeAll(async () => {
  adminId = await createUser(ADMIN_AUTH_ID, ROLES.ADMIN, 'conversion-admin@pragma.test');
  sellerId = await createUser(SELLER_AUTH_ID, ROLES.SELLER, 'conversion-seller@pragma.test');

  routeId = (await prisma.route.create({ data: { name: 'Conversion Test Route' } })).id;
  routeUserId = (
    await prisma.route_user.create({ data: { route_id: routeId, user_id: sellerId, day: 1 } })
  ).id;

  matchCustomerId = (
    await prisma.customer.create({
      data: { erp_customer_id: ERP_IDS[0], name: 'Farmacia Conversión Única' },
    })
  ).id;
  await prisma.customer.createMany({
    data: [
      { erp_customer_id: ERP_IDS[1], name: 'Farmacia Doble Test' },
      { erp_customer_id: ERP_IDS[2], name: 'FARMACIA DOBLE  TEST' },
    ],
  });

  for (const [key, name] of [
    ['match', '  farmacia  CONVERSION única '],
    ['ambiguous', 'Farmacia Doble Test'],
    ['none', 'Farmacia Sin Gemelo Test'],
  ]) {
    prospects[key] = (await prisma.prospect.create({ data: { user_id: sellerId, name } })).id;
  }

  const today = localToday();
  await prisma.scheduled_visit.createMany({
    data: [
      { route_user_id: routeUserId, visit_date: addDays(today, -2), prospect_id: prospects.match, is_extra: true },
      { route_user_id: routeUserId, visit_date: addDays(today, 0), prospect_id: prospects.match, is_extra: true },
      { route_user_id: routeUserId, visit_date: addDays(today, 3), prospect_id: prospects.match, is_extra: true },
    ],
  });
});

beforeEach(() => {
  verifyAccessTokenMock.mockResolvedValue({ sub: ADMIN_AUTH_ID });
});

afterAll(async () => {
  await prisma.scheduled_visit.deleteMany({ where: { route_user_id: routeUserId } });
  await prisma.prospect.deleteMany({ where: { id: { in: Object.values(prospects) } } });
  await prisma.customer.deleteMany({ where: { erp_customer_id: { in: ERP_IDS } } });
  await prisma.route_user.deleteMany({ where: { id: routeUserId } });
  await prisma.route.deleteMany({ where: { id: routeId } });
  await prisma.$executeRaw`delete from app_user where id in (${adminId}::uuid, ${sellerId}::uuid)`;
  await prisma.$executeRaw`delete from auth.users where id in (${ADMIN_AUTH_ID}::uuid, ${SELLER_AUTH_ID}::uuid)`;
  await prisma.$disconnect();
});

describe('POST /api/v1/prospects/:id/convert (PCRM-186)', () => {
  it('is closed to sellers', async () => {
    verifyAccessTokenMock.mockResolvedValue({ sub: SELLER_AUTH_ID });

    const res = await convert(prospects.match);

    expect(res.status).toBe(403);
  });

  it('links by normalised name, deactivates, and moves only the pending stops', async () => {
    const res = await convert(prospects.match);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      prospect_id: prospects.match,
      customer_id: matchCustomerId,
      customer_name: 'Farmacia Conversión Única',
      moved_stops: 2,
    });

    const prospect = await prisma.prospect.findUniqueOrThrow({
      where: { id: prospects.match },
      select: { active: true, customer_id: true, converted_at: true },
    });
    expect(prospect).toMatchObject({ active: false, customer_id: matchCustomerId });
    expect(prospect.converted_at).not.toBeNull();

    const stops = await prisma.scheduled_visit.findMany({
      where: { route_user_id: routeUserId },
      orderBy: { visit_date: 'asc' },
      select: { prospect_id: true, customer_id: true, is_extra: true },
    });
    expect(stops).toEqual([
      { prospect_id: prospects.match, customer_id: null, is_extra: true },
      { prospect_id: null, customer_id: matchCustomerId, is_extra: true },
      { prospect_id: null, customer_id: matchCustomerId, is_extra: true },
    ]);
  });

  it('answers 409 PROSPECT_ALREADY_CONVERTED on a second attempt', async () => {
    const res = await convert(prospects.match);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PROSPECT_ALREADY_CONVERTED');
  });

  it('only alerts when the name matches two customers: 409 and nothing linked', async () => {
    const res = await convert(prospects.ambiguous);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PROSPECT_NAME_AMBIGUOUS');
    expect(res.body.message).toMatch(/matches 2 customers/);
    const row = await prisma.prospect.findUniqueOrThrow({
      where: { id: prospects.ambiguous },
      select: { active: true, customer_id: true },
    });
    expect(row).toEqual({ active: true, customer_id: null });
  });

  it('answers 409 PROSPECT_NO_MATCHING_CUSTOMER when no customer has the name', async () => {
    const res = await convert(prospects.none);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PROSPECT_NO_MATCHING_CUSTOMER');
  });

  it('lists converted prospects apart with ?active=false', async () => {
    const res = await request(app)
      .get('/api/v1/prospects')
      .query({ active: 'false', user_id: sellerId })
      .set(HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([
      expect.objectContaining({ id: prospects.match, active: false, customer_id: matchCustomerId }),
    ]);
  });
});
