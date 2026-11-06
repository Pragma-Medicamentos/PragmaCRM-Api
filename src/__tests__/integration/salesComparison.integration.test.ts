import request from 'supertest';
import { verifyAccessToken } from '../../lib/supabaseJwt';
import { prisma } from '../../lib/prisma';
import { AppRoutes } from '../../presentation/routes';
import { Server } from '../../presentation/server';
import { envs } from '../../config/envs';
import { ROLES } from '../../domain/types/auth.types';

/**
 * PCRM-187 against real Postgres: totals, previous period, variation and the
 * breakdowns on a hand-built set of sales. March 2020 is far from anything
 * supabase/seed.sql generates (last 18 months), so even the unfiltered totals
 * are exact. Token verification is mocked.
 *
 *   selected  2020-03-01 .. 2020-03-31 (31 days)
 *   previous  2020-01-30 .. 2020-02-29 (the 31 days right before)
 */

jest.mock('../../lib/supabaseJwt', () => ({
  verifyAccessToken: jest.fn(),
  JwksUnavailableError: class extends Error {},
  warmUpJwks: jest.fn(),
}));

const verifyAccessTokenMock = verifyAccessToken as unknown as jest.Mock;

const ADMIN_AUTH_ID = 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1';
const HEADERS = { 'x-api-key': envs.API_KEY, Authorization: 'Bearer test' };
const RANGE = { from: '2020-03-01', to: '2020-03-31' };
const SALE_IDS = [9187101, 9187102, 9187103, 9187104, 9187105, 9187106, 9187107, 9187108];

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

let adminId: string;
let sellerId: string;
let customerA: string;
let customerB: string;

const get = (query: Record<string, string>) =>
  request(app)
    .get('/api/v1/metrics/sales/comparison')
    .query({ ...RANGE, ...query })
    .set(HEADERS);

beforeAll(async () => {
  await prisma.$executeRaw`
    insert into auth.users (id, instance_id, aud, role, email)
    values (
      ${ADMIN_AUTH_ID}::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'authenticated', 'authenticated', 'sales-comparison-admin@pragma.test'
    )
    on conflict (id) do nothing`;

  adminId = (
    await prisma.app_user.create({
      data: {
        auth_user_id: ADMIN_AUTH_ID,
        role: ROLES.ADMIN,
        name: 'Sales Comparison Admin',
        email: 'sales-comparison-admin@pragma.test',
        active: true,
      },
    })
  ).id;
  sellerId = (
    await prisma.app_user.create({
      data: {
        role: ROLES.SELLER,
        name: 'Comparison Seller',
        email: 'sales-comparison-seller@pragma.test',
        active: true,
      },
    })
  ).id;
  customerA = (await prisma.customer.create({ data: { name: 'Comparison A' } })).id;
  customerB = (await prisma.customer.create({ data: { name: 'Comparison B' } })).id;

  const sale = (
    id: number,
    at: string,
    total: string,
    customer: string,
    seller: string | null,
    extra: { erp_status?: number; deleted_at?: Date } = {}
  ) => ({
    erp_sale_id: id,
    erp_created_at: new Date(at),
    total,
    customer_id: customer,
    user_id: seller,
    erp_status: 2,
    payment_id: 1,
    pending_balance: '0.00',
    ...extra,
  });

  await prisma.sale.createMany({
    data: [
      // Selected period
      sale(SALE_IDS[0], '2020-03-10T12:00:00-06:00', '100.00', customerA, sellerId),
      sale(SALE_IDS[1], '2020-03-12T09:00:00-06:00', '50.00', customerA, sellerId),
      sale(SALE_IDS[2], '2020-03-15T10:00:00-06:00', '30.00', customerB, null),
      // 23:30 of the last local day is 05:30Z of April 1st: still March.
      sale(SALE_IDS[3], '2020-03-31T23:30:00-06:00', '20.00', customerB, sellerId),
      // Previous period
      sale(SALE_IDS[4], '2020-02-15T12:00:00-06:00', '60.00', customerA, sellerId),
      // Never counted: a quote, a deleted sale, and the first minutes of April.
      sale(SALE_IDS[5], '2020-03-11T12:00:00-06:00', '999.00', customerA, sellerId, {
        erp_status: 1,
      }),
      sale(SALE_IDS[6], '2020-03-11T12:00:00-06:00', '999.00', customerA, sellerId, {
        deleted_at: new Date(),
      }),
      sale(SALE_IDS[7], '2020-04-01T00:30:00-06:00', '999.00', customerA, sellerId),
    ],
  });
});

beforeEach(() => {
  verifyAccessTokenMock.mockResolvedValue({ sub: ADMIN_AUTH_ID });
});

afterAll(async () => {
  await prisma.sale.deleteMany({ where: { erp_sale_id: { in: SALE_IDS } } });
  await prisma.$executeRaw`delete from customer where id in (${customerA}::uuid, ${customerB}::uuid)`;
  await prisma.$executeRaw`delete from app_user where id in (${adminId}::uuid, ${sellerId}::uuid)`;
  await prisma.$executeRaw`delete from auth.users where id = ${ADMIN_AUTH_ID}::uuid`;
  await prisma.$disconnect();
});

describe('GET /api/v1/metrics/sales/comparison', () => {
  it('compares the totals against the previous period of equal length', async () => {
    const res = await get({});

    expect(res.status).toBe(200);
    expect(res.body.data.previous_period).toEqual({ from: '2020-01-30', to: '2020-02-29' });
    expect(res.body.data.totals).toEqual({
      current: { total_sales: '200.00', orders_count: 4, average_ticket: '50.00' },
      previous: { total_sales: '60.00', orders_count: 1, average_ticket: '60.00' },
      variation: {
        total_sales: { amount: '140.00', pct: 233.3 },
        orders_count: { amount: 3, pct: 300 },
        average_ticket: { amount: '-10.00', pct: -16.7 },
      },
    });
    expect(res.body.data.breakdown).toBeNull();
  });

  it('groups by seller, with the unassigned sales in a null row', async () => {
    const res = await get({ group_by: 'seller' });
    const { breakdown } = res.body.data;

    expect(breakdown).toMatchObject({ group_by: 'seller', total: 2, page: 1 });
    expect(breakdown.items[0]).toMatchObject({
      id: sellerId,
      name: 'Comparison Seller',
      current: { total_sales: '170.00', orders_count: 3 },
      previous: { total_sales: '60.00', orders_count: 1 },
    });
    expect(breakdown.items[1]).toMatchObject({
      id: null,
      name: null,
      current: { total_sales: '30.00' },
      variation: { total_sales: { amount: '30.00', pct: null } },
    });
  });

  it('filters by customer: no previous sales means no percentage', async () => {
    const res = await get({ customer_id: customerB });

    expect(res.body.data.filters).toEqual({ customer_id: customerB, user_id: null });
    expect(res.body.data.totals.current).toEqual({
      total_sales: '50.00',
      orders_count: 2,
      average_ticket: '25.00',
    });
    expect(res.body.data.totals.variation).toEqual({
      total_sales: { amount: '50.00', pct: null },
      orders_count: { amount: 2, pct: null },
      average_ticket: { amount: null, pct: null },
    });
  });

  it('combines the seller filter with the breakdown by customer, paginated', async () => {
    const first = await get({ user_id: sellerId, group_by: 'customer', limit: '1' });
    const second = await get({ user_id: sellerId, group_by: 'customer', limit: '1', page: '2' });

    expect(first.body.data.totals.current.total_sales).toBe('170.00');
    expect(first.body.data.breakdown).toMatchObject({ total: 2, total_pages: 2 });
    expect(first.body.data.breakdown.items[0]).toMatchObject({
      id: customerA,
      current: { total_sales: '150.00' },
      variation: { total_sales: { amount: '90.00', pct: 150 } },
    });
    expect(second.body.data.breakdown.items[0]).toMatchObject({
      id: customerB,
      current: { total_sales: '20.00' },
    });
  });

  it('answers 404 for an id that does not exist', async () => {
    const res = await get({ user_id: '00000000-0000-4000-8000-000000000000' });

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Seller not found');
  });
});
