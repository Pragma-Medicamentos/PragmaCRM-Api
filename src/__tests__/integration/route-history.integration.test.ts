import request from 'supertest';
import { verifyAccessToken } from '../../lib/supabaseJwt';
import { prisma } from '../../lib/prisma';
import { AppRoutes } from '../../presentation/routes';
import { Server } from '../../presentation/server';
import { envs } from '../../config/envs';
import { ROLES } from '../../domain/types/auth.types';

/**
 * PCRM-203: the seller's route history and the past-day detail against real
 * Postgres. The unit tests only see the SQL text; here the visibility rule
 * for retired assignments runs for real, and the history counts are checked
 * against GET /me/route?date= for the same day. Token verification is mocked.
 */

jest.mock('../../lib/supabaseJwt', () => ({
  verifyAccessToken: jest.fn(),
  JwksUnavailableError: class extends Error {},
  warmUpJwks: jest.fn(),
}));

const verifyAccessTokenMock = verifyAccessToken as unknown as jest.Mock;

const SELLER_AUTH_ID = 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5';
const HEADERS = { 'x-api-key': envs.API_KEY, Authorization: 'Bearer test' };

// Two Mondays and the Tuesday in between, all long gone.
const MONDAY_1 = '2026-09-07';
const TUESDAY_1 = '2026-09-08';
const MONDAY_2 = '2026-09-14';

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

let sellerId: string;
let customerIds: string[];
let routeId: string;
let mondayRouteUserId: string;
let tuesdayRouteUserId: string;

const createStop = async (routeUserId: string, date: string, customerId: string) =>
  (
    await prisma.scheduled_visit.create({
      data: {
        route_user_id: routeUserId,
        customer_id: customerId,
        visit_date: new Date(`${date}T00:00:00.000Z`),
      },
    })
  ).id;

const executeStop = (stopId: string, routeUserId: string, customerId: string, at: string) =>
  prisma.$executeRaw`
    insert into visit (customer_id, user_id, route_user_id, scheduled_visit_id,
                       started_at, checkin_location, distance_meters, visit_type)
    values (${customerId}::uuid, ${sellerId}::uuid, ${routeUserId}::uuid, ${stopId}::uuid,
            ${at}::timestamptz,
            extensions.ST_SetSRID(extensions.ST_MakePoint(-89.21, 13.71), 4326)::extensions.geography,
            12.5, 'visit')`;

const history = (query: Record<string, string | number> = {}) =>
  request(app).get('/api/v1/me/route/history').query(query).set(HEADERS);

beforeAll(async () => {
  await prisma.$executeRaw`
    insert into auth.users (id, instance_id, aud, role, email)
    values (
      ${SELLER_AUTH_ID}::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'authenticated', 'authenticated', 'history-seller@pragma.test'
    )
    on conflict (id) do nothing`;

  sellerId = (
    await prisma.app_user.create({
      data: {
        auth_user_id: SELLER_AUTH_ID,
        role: ROLES.SELLER,
        name: 'History Test Seller',
        email: 'history-seller@pragma.test',
        active: true,
      },
    })
  ).id;

  customerIds = [];
  for (const name of ['History Customer A', 'History Customer B', 'History Customer C']) {
    customerIds.push((await prisma.customer.create({ data: { name } })).id);
  }

  routeId = (await prisma.route.create({ data: { name: 'History Test Route', zone: 'Escalón' } })).id;
  mondayRouteUserId = (
    await prisma.route_user.create({ data: { route_id: routeId, user_id: sellerId, day: 1 } })
  ).id;
  tuesdayRouteUserId = (
    await prisma.route_user.create({ data: { route_id: routeId, user_id: sellerId, day: 2 } })
  ).id;

  // Monday 1: A executed, B and C never marked.
  const [a1] = [
    await createStop(mondayRouteUserId, MONDAY_1, customerIds[0]),
    await createStop(mondayRouteUserId, MONDAY_1, customerIds[1]),
    await createStop(mondayRouteUserId, MONDAY_1, customerIds[2]),
  ];
  await executeStop(a1, mondayRouteUserId, customerIds[0], `${MONDAY_1}T15:10:00Z`);

  // Tuesday 1: A executed.
  const a2 = await createStop(tuesdayRouteUserId, TUESDAY_1, customerIds[0]);
  await executeStop(a2, tuesdayRouteUserId, customerIds[0], `${TUESDAY_1}T15:10:00Z`);

  // Monday 2: A executed, B never marked.
  const a3 = await createStop(mondayRouteUserId, MONDAY_2, customerIds[0]);
  await createStop(mondayRouteUserId, MONDAY_2, customerIds[1]);
  await executeStop(a3, mondayRouteUserId, customerIds[0], `${MONDAY_2}T15:10:00Z`);
});

beforeEach(() => {
  verifyAccessTokenMock.mockResolvedValue({ sub: SELLER_AUTH_ID });
});

afterAll(async () => {
  const routeUsers = [mondayRouteUserId, tuesdayRouteUserId];
  await prisma.visit.deleteMany({ where: { user_id: sellerId } });
  await prisma.scheduled_visit.deleteMany({ where: { route_user_id: { in: routeUsers } } });
  await prisma.route_user.deleteMany({ where: { id: { in: routeUsers } } });
  await prisma.route.deleteMany({ where: { id: routeId } });
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  await prisma.app_user.deleteMany({ where: { id: sellerId } });
  await prisma.$executeRaw`delete from auth.users where id = ${SELLER_AUTH_ID}::uuid`;
  await prisma.$disconnect();
});

describe('GET /api/v1/me/route/history (real Postgres)', () => {
  it('summarises each past day, newest first', async () => {
    const res = await history();

    expect(res.status).toBe(200);
    const days = res.body.data.days.filter((day: { date: string }) =>
      [MONDAY_1, TUESDAY_1, MONDAY_2].includes(day.date)
    );
    expect(days.map((day: { date: string }) => day.date)).toEqual([MONDAY_2, TUESDAY_1, MONDAY_1]);
    expect(days[2]).toMatchObject({
      total: 3,
      completed: 1,
      skipped: 2,
      routes: [{ id: routeId, name: 'History Test Route', zone: 'Escalón' }],
    });
    expect(days[2].skipped_stops.map((stop: { name: string }) => stop.name)).toEqual([
      'History Customer B',
      'History Customer C',
    ]);
  });

  it('pages by date with before and next_before', async () => {
    const first = await history({ before: '2026-09-15', limit: 2 });

    expect(first.body.data.days.map((day: { date: string }) => day.date)).toEqual([
      MONDAY_2,
      TUESDAY_1,
    ]);
    expect(first.body.data.next_before).toBe(TUESDAY_1);

    const second = await history({ before: first.body.data.next_before, limit: 2 });
    expect(second.body.data.days[0].date).toBe(MONDAY_1);
  });

  it('keeps a reassigned day in the history, and in its detail', async () => {
    // Monday 2 the route was reassigned: the old assignment dies that day.
    await prisma.route_user.update({
      where: { id: mondayRouteUserId },
      data: { deleted_at: new Date(`${MONDAY_2}T20:00:00Z`) },
    });

    try {
      const res = await history({ before: '2026-09-15', limit: 3 });
      const byDate = Object.fromEntries(
        res.body.data.days.map((day: { date: string }) => [day.date, day])
      );

      // Before the reassignment: every stop is still the seller's record.
      expect(byDate[MONDAY_1]).toMatchObject({ total: 3, completed: 1, skipped: 2 });
      // The day it died: only what he executed, nothing invented as skipped.
      expect(byDate[MONDAY_2]).toMatchObject({ total: 1, completed: 1, skipped: 0 });

      // The detail of the same days agrees with the counts.
      for (const [date, total] of [
        [MONDAY_1, 3],
        [MONDAY_2, 1],
      ] as const) {
        const detail = await request(app).get('/api/v1/me/route').query({ date }).set(HEADERS);
        expect(detail.body.data.stops).toHaveLength(total);
      }
    } finally {
      await prisma.route_user.update({
        where: { id: mondayRouteUserId },
        data: { deleted_at: null },
      });
    }
  });
});

describe('GET /api/v1/me/route?date= — past-day detail (real PostGIS)', () => {
  it('returns where and how far the seller marked each executed stop', async () => {
    const res = await request(app).get('/api/v1/me/route').query({ date: TUESDAY_1 }).set(HEADERS);

    expect(res.body.data.stops[0]).toMatchObject({
      checkin_location: { lat: 13.71, lng: -89.21 },
      distance_meters: 12.5,
    });
  });
});
