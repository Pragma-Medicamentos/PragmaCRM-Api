import request from 'supertest';
import { verifyAccessToken } from '../../lib/supabaseJwt';
import { prisma } from '../../lib/prisma';
import { AppRoutes } from '../../presentation/routes';
import { Server } from '../../presentation/server';
import { envs } from '../../config/envs';
import { ROLES } from '../../domain/types/auth.types';

/**
 * Metrics panel (RF-09) against real Postgres: the raw SQL is only verifiable
 * here. Runs on the local Supabase database (loadEnv.ts forces .env.test).
 *
 * Every row lives in March 2020, a month the dev seed never touches, so exact
 * figures can be asserted even on a seeded database. Company-wide counts over
 * the whole portfolio (customers_without_visit, coverage) are not asserted for
 * the same reason.
 */

jest.mock('../../lib/supabaseJwt', () => ({
  verifyAccessToken: jest.fn(),
  JwksUnavailableError: class extends Error {},
  warmUpJwks: jest.fn(),
}));

const verifyAccessTokenMock = verifyAccessToken as unknown as jest.Mock;

const ADMIN_AUTH_ID = 'e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3';
const HEADERS = { 'x-api-key': envs.API_KEY, Authorization: 'Bearer test' };
const RANGE = 'from=2020-03-01&to=2020-03-31';

// Local El Salvador time (UTC-6), as the seller and the ERP see it.
const local = (isoLocal: string) => new Date(`${isoLocal}-06:00`);

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

const SALE_IDS = [9_900_001, 9_900_002, 9_900_003, 9_900_004, 9_900_005];

let adminId: string;
let sellerId: string;
let otherSellerId: string;
let routeId: string;
let routeUserId: string;
let customerA: string;
let customerB: string;

const get = (path: string) => request(app).get(`/api/v1/metrics${path}`).set(HEADERS);

beforeAll(async () => {
  await prisma.$executeRaw`
    insert into auth.users (id, instance_id, aud, role, email)
    values (
      ${ADMIN_AUTH_ID}::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'authenticated', 'authenticated', 'metrics-admin@pragma.test'
    )
    on conflict (id) do nothing`;

  adminId = (
    await prisma.app_user.create({
      data: {
        auth_user_id: ADMIN_AUTH_ID,
        role: ROLES.ADMIN,
        name: 'Metrics Test Admin',
        email: 'metrics-admin@pragma.test',
        active: true,
      },
    })
  ).id;
  sellerId = (
    await prisma.app_user.create({
      data: { role: ROLES.SELLER, name: 'Metrics Test Seller', active: true },
    })
  ).id;
  otherSellerId = (
    await prisma.app_user.create({
      data: { role: ROLES.SELLER, name: 'Metrics Test Other Seller', active: true },
    })
  ).id;

  customerA = (await prisma.customer.create({ data: { name: 'Metrics Customer A' } })).id;
  customerB = (await prisma.customer.create({ data: { name: 'Metrics Customer B' } })).id;

  routeId = (await prisma.route.create({ data: { name: 'Metrics Test Route' } })).id;
  await prisma.route_customer.createMany({
    data: [
      { route_id: routeId, customer_id: customerA, sort_order: 1 },
      { route_id: routeId, customer_id: customerB, sort_order: 2 },
    ],
  });
  routeUserId = (
    await prisma.route_user.create({
      data: { route_id: routeId, user_id: sellerId, day: 1 },
    })
  ).id;

  // Monday 2 March: one route day with a visit and a dispatch.
  const routeVisit = await prisma.visit.create({
    data: {
      customer_id: customerA,
      user_id: sellerId,
      route_user_id: routeUserId,
      visit_type: 'visit',
      successful: true,
      started_at: local('2020-03-02T10:00:00'),
      finished_at: local('2020-03-02T10:20:00'),
    },
  });
  const routeDispatch = await prisma.visit.create({
    data: {
      customer_id: customerB,
      user_id: sellerId,
      route_user_id: routeUserId,
      visit_type: 'dispatch',
      successful: false,
      started_at: local('2020-03-02T11:00:00'),
      finished_at: local('2020-03-02T11:10:00'),
    },
  });
  // Off-route visit.
  await prisma.visit.create({
    data: {
      customer_id: customerA,
      user_id: sellerId,
      visit_type: 'visit',
      successful: true,
      started_at: local('2020-03-09T10:00:00'),
      finished_at: local('2020-03-09T10:30:00'),
    },
  });

  await prisma.sale.createMany({
    data: [
      // Linked to the route visit.
      {
        erp_sale_id: SALE_IDS[0], customer_id: customerA, user_id: sellerId,
        visit_id: routeVisit.id, erp_status: 2, total: 100,
        erp_created_at: local('2020-03-02T12:00:00'),
      },
      // 7 p.m. on the last day: must stay in March, not spill into April.
      {
        erp_sale_id: SALE_IDS[1], customer_id: customerB, user_id: sellerId,
        erp_status: 2, total: 50,
        erp_created_at: local('2020-03-31T19:00:00'),
      },
      // A quote: never counted.
      {
        erp_sale_id: SALE_IDS[2], customer_id: customerA, user_id: sellerId,
        erp_status: 1, total: 999,
        erp_created_at: local('2020-03-05T09:00:00'),
      },
      // Customer B's previous purchase, 52 days before its next one.
      {
        erp_sale_id: SALE_IDS[3], customer_id: customerB, user_id: sellerId,
        erp_status: 2, total: 30,
        erp_created_at: local('2020-01-10T10:00:00'),
      },
      // Sale of the other seller delivered in our seller's dispatch.
      {
        erp_sale_id: SALE_IDS[4], customer_id: customerB, user_id: otherSellerId,
        visit_id: routeDispatch.id, erp_status: 2, total: 20,
        erp_created_at: local('2020-03-02T13:00:00'),
      },
    ],
  });

  await prisma.goal.create({
    data: { user_id: sellerId, year: 2020, month: 3, goal_amount: 300 },
  });
  await prisma.prospect.create({
    data: {
      user_id: sellerId,
      name: 'Metrics Prospect',
      created_at: local('2020-03-15T09:00:00'),
    },
  });
});

beforeEach(() => {
  verifyAccessTokenMock.mockResolvedValue({ sub: ADMIN_AUTH_ID });
});

afterAll(async () => {
  const users = [sellerId, otherSellerId];
  await prisma.$executeRaw`delete from sale where erp_sale_id in (${SALE_IDS[0]}, ${SALE_IDS[1]}, ${SALE_IDS[2]}, ${SALE_IDS[3]}, ${SALE_IDS[4]})`;
  await prisma.$executeRaw`delete from visit where user_id in (${users[0]}::uuid, ${users[1]}::uuid)`;
  await prisma.$executeRaw`delete from prospect where user_id = ${sellerId}::uuid`;
  await prisma.$executeRaw`delete from goal where user_id = ${sellerId}::uuid`;
  await prisma.$executeRaw`delete from route_user where id = ${routeUserId}::uuid`;
  await prisma.$executeRaw`delete from route_customer where route_id = ${routeId}::uuid`;
  await prisma.$executeRaw`delete from route where id = ${routeId}::uuid`;
  await prisma.$executeRaw`delete from customer where id in (${customerA}::uuid, ${customerB}::uuid)`;
  await prisma.$executeRaw`delete from app_user where id in (${adminId}::uuid, ${users[0]}::uuid, ${users[1]}::uuid)`;
  await prisma.$executeRaw`delete from auth.users where id = ${ADMIN_AUTH_ID}::uuid`;
  await prisma.$disconnect();
});

describe('GET /api/v1/metrics/kpis (real Postgres)', () => {
  it('computes the period KPIs from the raw tables', async () => {
    const res = await get(`/kpis?${RANGE}`);

    expect(res.status).toBe(200);
    const { kpis } = res.body.data;
    // 31 days back from 29 February (leap year).
    expect(res.body.data.previous_period).toEqual({ from: '2020-01-30', to: '2020-02-29' });

    expect(kpis.stops_executed.value).toBe(3);
    expect(kpis.stops_by_type.value).toEqual({ visit: 2, dispatch: 1, collection: 0 });
    expect(kpis.visited_customers.value).toBe(2);
    expect(kpis.effective_visits_rate.value).toBe(66.7);
    expect(kpis.average_visit_minutes.value).toBe(20);

    // 100 + 50 (7 p.m. on the 31st) + 20; the 999 quote is excluded.
    expect(kpis.total_sales.value).toBe('170.00');
    expect(kpis.orders_count.value).toBe(3);
    expect(kpis.average_ticket.value).toBe('56.67');
    expect(kpis.average_monthly_sales.value).toBe('170.00');
    // Route sales (100 + 20) over one executed route day.
    expect(kpis.route_effectiveness.value).toBe('120.00');
    // Only the seller with a goal counts: 150 / 300.
    expect(kpis.goal_compliance.value).toBe(50);

    // B bought on 2 March after 52 days without buying.
    expect(kpis.recovered_customers.value).toBe(1);
    // Gaps of 52.125 and 29.25 days.
    expect(kpis.purchase_frequency_days.value).toBe(41);
    expect(kpis.new_prospects.value).toBe(1);
  });

  it('honours the inactivity override for recovered customers', async () => {
    const res = await get(`/kpis?${RANGE}&inactivity_days=60`);

    expect(res.body.data.thresholds.inactivity_days).toBe(60);
    expect(res.body.data.kpis.recovered_customers.value).toBe(0);
  });

  it('returns only the selected KPIs, computed like the full set', async () => {
    const res = await get(`/kpis?${RANGE}&kpis=average_ticket,total_sales`);

    expect(res.status).toBe(200);
    expect(res.body.data.kpis).toEqual({
      average_ticket: expect.objectContaining({ value: '56.67' }),
      total_sales: expect.objectContaining({ value: '170.00' }),
    });
  });
});

describe('GET /api/v1/metrics/sellers (real Postgres)', () => {
  it('credits sales to the ERP seller and stops to the executor', async () => {
    const res = await get(`/sellers?${RANGE}`);

    expect(res.status).toBe(200);
    const seller = res.body.data.sellers.find((s: { user_id: string }) => s.user_id === sellerId);
    const other = res.body.data.sellers.find((s: { user_id: string }) => s.user_id === otherSellerId);

    expect(seller).toMatchObject({
      stops_executed: 3,
      stops_by_type: { visit: 2, dispatch: 1, collection: 0 },
      orders_count: 2,
      total_sales: '150.00',
      average_ticket: '75.00',
      goal_amount: '300.00',
      goal_compliance: 50,
      route_sales: '100.00',
      executed_route_days: 1,
      sales_per_route: '100.00',
      dispatches_for_others: 1,
      portfolio_customers: 2,
    });
    expect(other).toMatchObject({
      stops_executed: 0,
      orders_count: 1,
      total_sales: '20.00',
      goal_amount: null,
      goal_compliance: null,
      sales_per_route: null,
    });
  });

  it('returns the detail with forgotten customers of the portfolio', async () => {
    const res = await get(`/sellers/${sellerId}?${RANGE}&inactivity_days=10`);

    expect(res.status).toBe(200);
    // Measured from the end of March: A was last visited on the 9th (22 days),
    // B on the 2nd (29 days).
    const names = res.body.data.customers_without_visit.map((c: { name: string }) => c.name);
    expect(names).toEqual(['Metrics Customer B', 'Metrics Customer A']);
    expect(res.body.data.customers_without_visit[0].days_since_last_visit).toBe(29);
  });

  it('answers 404 for an unknown seller', async () => {
    const res = await get(`/sellers/00000000-0000-4000-8000-000000000000?${RANGE}`);

    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/metrics/trends (real Postgres)', () => {
  it('buckets by local month', async () => {
    const res = await get(`/trends?${RANGE}&granularity=month`);

    expect(res.status).toBe(200);
    expect(res.body.data.points).toEqual([
      {
        bucket_start: '2020-03-01',
        stops: 3,
        orders_count: 3,
        total_sales: '170.00',
        average_ticket: '56.67',
      },
    ]);
  });
});
