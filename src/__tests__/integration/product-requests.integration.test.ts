import { randomUUID } from 'crypto';
import request from 'supertest';
import { verifyAccessToken } from '../../lib/supabaseJwt';
import { prisma } from '../../lib/prisma';
import { AppRoutes } from '../../presentation/routes';
import { Server } from '../../presentation/server';
import { envs } from '../../config/envs';
import { ROLES } from '../../domain/types/auth.types';

/**
 * Off-catalog product requests (RF-11, PCRM-65) against real Postgres: the
 * visit lookup by stop, the case-insensitive reuse of `quoted_product` and the
 * advisory lock that keeps concurrent first requests from duplicating it.
 * Runs on the local Supabase database (loadEnv.ts forces .env.test). Token
 * verification is mocked.
 */

jest.mock('../../lib/supabaseJwt', () => ({
  verifyAccessToken: jest.fn(),
  JwksUnavailableError: class extends Error {},
  warmUpJwks: jest.fn(),
}));

const verifyAccessTokenMock = verifyAccessToken as unknown as jest.Mock;

const SELLER_AUTH_ID = 'f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3';
const OTHER_SELLER_ID = '00000000-0000-4000-8000-00000000f065';
const ENDPOINT = '/api/v1/product-requests';
const HEADERS = { 'x-api-key': envs.API_KEY, Authorization: 'Bearer test' };

const PIN = { lat: 13.7, lng: -89.2 };
const PLANNED_DAY = '2026-09-15';

// Product names are unique per run so a shared local database with earlier
// quoted_product rows cannot make the reuse assertions pass by accident.
const RUN = randomUUID().slice(0, 8);
const productName = (label: string) => `PCRM-65 ${label} ${RUN}`;

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

let sellerId: string;
let customerId: string;
let routeId: string;
let routeUserId: string;
let pendingStopId: string;
let visitedStopId: string;
let visitId: string;

const createStop = async (stopType: 'visit' | 'collection') =>
  (
    await prisma.scheduled_visit.create({
      data: {
        route_user_id: routeUserId,
        visit_date: new Date(`${PLANNED_DAY}T00:00:00.000Z`),
        customer_id: customerId,
        stop_type: stopType,
        // Extra stops: two planned stops for the same customer and day would
        // collide on scheduled_visit_planned_uq.
        is_extra: true,
      },
    })
  ).id;

const post = (body: Record<string, unknown>) =>
  request(app).post(ENDPOINT).set(HEADERS).send(body);

const quotedProductsNamed = (name: string) =>
  prisma.$queryRaw<{ id: string }[]>`
    select id::text as id from quoted_product
    where lower(name) = lower(${name}) and deleted_at is null`;

beforeAll(async () => {
  await prisma.$executeRaw`
    insert into auth.users (id, instance_id, aud, role, email)
    values (
      ${SELLER_AUTH_ID}::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'authenticated', 'authenticated', 'product-requests-seller@pragma.test'
    )
    on conflict (id) do nothing`;

  sellerId = (
    await prisma.app_user.create({
      data: {
        auth_user_id: SELLER_AUTH_ID,
        role: ROLES.SELLER,
        name: 'Product Requests Test Seller',
        email: 'product-requests-seller@pragma.test',
        active: true,
      },
    })
  ).id;

  await prisma.app_user.create({
    data: {
      id: OTHER_SELLER_ID,
      role: ROLES.SELLER,
      name: 'Product Requests Other Seller',
      active: true,
    },
  });

  customerId = (
    await prisma.customer.create({ data: { name: 'Product Requests Test Customer' } })
  ).id;
  await prisma.$executeRaw`
    update customer
    set location = extensions.ST_SetSRID(
      extensions.ST_MakePoint(${PIN.lng}, ${PIN.lat}), 4326
    )::extensions.geography
    where id = ${customerId}::uuid`;

  routeId = (
    await prisma.route.create({ data: { name: 'Product Requests Test Route' } })
  ).id;
  routeUserId = (
    await prisma.route_user.create({
      data: { route_id: routeId, user_id: sellerId, day: 2 },
    })
  ).id;

  pendingStopId = await createStop('collection');
  visitedStopId = await createStop('visit');

  verifyAccessTokenMock.mockResolvedValue({ sub: SELLER_AUTH_ID });
  const confirmed = await request(app)
    .post('/api/v1/visits')
    .set(HEADERS)
    .send({
      scheduled_visit_id: visitedStopId,
      latitude: PIN.lat,
      longitude: PIN.lng,
      captured_at: `${PLANNED_DAY}T10:00:00-06:00`,
    });
  expect(confirmed.status).toBe(201);
  visitId = confirmed.body.data.id;
});

beforeEach(() => {
  verifyAccessTokenMock.mockResolvedValue({ sub: SELLER_AUTH_ID });
});

afterAll(async () => {
  await prisma.$executeRaw`delete from product_request where user_id = ${sellerId}::uuid`;
  await prisma.$executeRaw`delete from quoted_product where name like ${`PCRM-65 % ${RUN}`}`;
  await prisma.$executeRaw`delete from visit where user_id = ${sellerId}::uuid`;
  await prisma.$executeRaw`delete from scheduled_visit where route_user_id = ${routeUserId}::uuid`;
  await prisma.$executeRaw`delete from route_user where id = ${routeUserId}::uuid`;
  await prisma.$executeRaw`delete from route where id = ${routeId}::uuid`;
  await prisma.$executeRaw`delete from customer where id = ${customerId}::uuid`;
  await prisma.$executeRaw`delete from app_user where id in (${sellerId}::uuid, ${OTHER_SELLER_ID}::uuid)`;
  await prisma.$executeRaw`delete from auth.users where id = ${SELLER_AUTH_ID}::uuid`;
  await prisma.$disconnect();
});

describe('POST /api/v1/product-requests (real Postgres)', () => {
  it('ties the request to the customer and visit of the stop (HU-11 CA1)', async () => {
    const name = productName('Ibuprofeno');

    const res = await post({
      scheduled_visit_id: visitedStopId,
      product_name: name,
      requested_quantity: 12.5,
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      visit_id: visitId,
      customer_id: customerId,
      scheduled_visit_id: visitedStopId,
      quoted_product: { name },
      requested_quantity: 12.5,
    });

    const [stored] = await prisma.$queryRaw<
      {
        visit_id: string;
        customer_id: string;
        user_id: string;
        quoted_product_id: string;
        requested_quantity: number;
      }[]
    >`
      select visit_id::text as visit_id, customer_id::text as customer_id,
             user_id::text as user_id, quoted_product_id::text as quoted_product_id,
             requested_quantity::float8 as requested_quantity
      from product_request
      where id = ${res.body.data.id}::uuid`;
    expect(stored).toEqual({
      visit_id: visitId,
      customer_id: customerId,
      user_id: sellerId,
      quoted_product_id: res.body.data.quoted_product.id,
      requested_quantity: 12.5,
    });
  });

  it('stores a request without quantity as null', async () => {
    const res = await post({
      scheduled_visit_id: visitedStopId,
      product_name: productName('Sin cantidad'),
    });

    expect(res.status).toBe(201);
    expect(res.body.data.requested_quantity).toBeNull();
  });

  it('reuses the product when the name differs only in case and spacing', async () => {
    const first = await post({
      scheduled_visit_id: visitedStopId,
      product_name: productName('Jarabe Infantil'),
    });
    const second = await post({
      scheduled_visit_id: visitedStopId,
      product_name: `  ${productName('JARABE   infantil').toLowerCase()} `,
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.quoted_product).toEqual(first.body.data.quoted_product);
    expect(await quotedProductsNamed(productName('Jarabe Infantil'))).toHaveLength(1);
  });

  it('creates a single product when the first requests arrive concurrently', async () => {
    const name = productName('Concurrente');

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        post({ scheduled_visit_id: visitedStopId, product_name: name })
      )
    );

    expect(responses.map((res) => res.status)).toEqual([201, 201, 201, 201, 201]);
    expect(new Set(responses.map((res) => res.body.data.quoted_product.id)).size).toBe(1);
    expect(await quotedProductsNamed(name)).toHaveLength(1);
  });

  it('answers 422 while the stop has not been confirmed', async () => {
    const name = productName('Sin visita');

    const res = await post({ scheduled_visit_id: pendingStopId, product_name: name });

    expect(res.status).toBe(422);
    expect(await quotedProductsNamed(name)).toHaveLength(0);
  });

  it("answers 403 for another seller's stop", async () => {
    await prisma.route_user.update({
      where: { id: routeUserId },
      data: { user_id: OTHER_SELLER_ID },
    });

    try {
      const res = await post({
        scheduled_visit_id: visitedStopId,
        product_name: productName('Ajeno'),
      });

      expect(res.status).toBe(403);
    } finally {
      await prisma.route_user.update({
        where: { id: routeUserId },
        data: { user_id: sellerId },
      });
    }
  });

  it('answers 404 for a stop that does not exist', async () => {
    const res = await post({
      scheduled_visit_id: randomUUID(),
      product_name: productName('Inexistente'),
    });

    expect(res.status).toBe(404);
  });
});
