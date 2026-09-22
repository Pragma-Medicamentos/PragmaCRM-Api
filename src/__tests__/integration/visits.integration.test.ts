import request from 'supertest';
import { verifyAccessToken } from '../../lib/supabaseJwt';
import { prisma } from '../../lib/prisma';
import { AppRoutes } from '../../presentation/routes';
import { Server } from '../../presentation/server';
import { envs } from '../../config/envs';
import { ROLES } from '../../domain/types/auth.types';

/**
 * Stop confirmation (RF-06) against real Postgres/PostGIS: exercises the raw
 * SQL that the unit tests can only mock. Runs on the local Supabase database
 * (loadEnv.ts forces .env.test). Token verification is mocked.
 */

jest.mock('../../lib/supabaseJwt', () => ({
  verifyAccessToken: jest.fn(),
  JwksUnavailableError: class extends Error {},
  warmUpJwks: jest.fn(),
}));

const verifyAccessTokenMock = verifyAccessToken as unknown as jest.Mock;

const SELLER_AUTH_ID = 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2';
const ENDPOINT = '/api/v1/visits';
const HEADERS = { 'x-api-key': envs.API_KEY, Authorization: 'Bearer test' };

// The customer's pin. Latitude offsets: 0.0004° is ~44 m, 0.002° is ~221 m.
const PIN = { lat: 13.7, lng: -89.2 };

// A fixed past day, so captured_at is never in the future.
const PLANNED_DAY = '2026-09-14';
const capturedAt = (localTime: string) => `${PLANNED_DAY}T${localTime}-06:00`;

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

let sellerId: string;
let customerId: string;
let routeId: string;
let routeUserId: string;
let noPinCustomerId: string;

const createStop = async (customer: string | null = customerId) =>
  (
    await prisma.scheduled_visit.create({
      data: {
        route_user_id: routeUserId,
        visit_date: new Date(`${PLANNED_DAY}T00:00:00.000Z`),
        customer_id: customer,
        stop_type: 'visit',
      },
    })
  ).id;

const post = (body: Record<string, unknown>) =>
  request(app).post(ENDPOINT).set(HEADERS).send(body);

beforeAll(async () => {
  await prisma.$executeRaw`
    insert into auth.users (id, instance_id, aud, role, email)
    values (
      ${SELLER_AUTH_ID}::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'authenticated', 'authenticated', 'visits-seller@pragma.test'
    )
    on conflict (id) do nothing`;

  const seller = await prisma.app_user.create({
    data: {
      auth_user_id: SELLER_AUTH_ID,
      role: ROLES.SELLER,
      name: 'Visits Test Seller',
      email: 'visits-seller@pragma.test',
      active: true,
    },
  });
  sellerId = seller.id;

  const customer = await prisma.customer.create({
    data: { name: 'Visits Test Customer' },
  });
  customerId = customer.id;
  await prisma.$executeRaw`
    update customer
    set location = extensions.ST_SetSRID(
      extensions.ST_MakePoint(${PIN.lng}, ${PIN.lat}), 4326
    )::extensions.geography
    where id = ${customerId}::uuid`;

  noPinCustomerId = (
    await prisma.customer.create({ data: { name: 'Visits Test No Pin' } })
  ).id;

  routeId = (await prisma.route.create({ data: { name: 'Visits Test Route' } })).id;
  await prisma.route_customer.create({
    data: { route_id: routeId, customer_id: customerId, sort_order: 1 },
  });
  routeUserId = (
    await prisma.route_user.create({
      data: { route_id: routeId, user_id: sellerId, day: 1 },
    })
  ).id;
});

beforeEach(async () => {
  verifyAccessTokenMock.mockResolvedValue({ sub: SELLER_AUTH_ID });
  // Every test plans its own stop for the same customer and day; without this
  // the previous test's visit would be found as an already-confirmed stop.
  await prisma.$executeRaw`delete from visit where user_id = ${sellerId}::uuid`;
});

afterAll(async () => {
  await prisma.$executeRaw`delete from visit where user_id = ${sellerId}::uuid`;
  await prisma.$executeRaw`delete from scheduled_visit where route_user_id = ${routeUserId}::uuid`;
  await prisma.$executeRaw`delete from route_user where id = ${routeUserId}::uuid`;
  await prisma.$executeRaw`delete from route_customer where route_id = ${routeId}::uuid`;
  await prisma.$executeRaw`delete from route where id = ${routeId}::uuid`;
  await prisma.$executeRaw`delete from customer where id in (${customerId}::uuid, ${noPinCustomerId}::uuid)`;
  await prisma.$executeRaw`delete from app_user where id in (${sellerId}::uuid, '00000000-0000-4000-8000-00000000f003'::uuid)`;
  await prisma.$executeRaw`delete from auth.users where id = ${SELLER_AUTH_ID}::uuid`;
  await prisma.$disconnect();
});

describe('POST /api/v1/visits (real PostGIS)', () => {
  it('stores the check-in inside the radius with the computed distance', async () => {
    const stopId = await createStop();

    const res = await post({
      scheduled_visit_id: stopId,
      latitude: PIN.lat + 0.0004,
      longitude: PIN.lng,
      captured_at: capturedAt('10:00:00'),
      notes: 'Owner was away, assistant attended',
      successful: true,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.within_radius).toBe(true);
    expect(res.body.data.distance_meters).toBeGreaterThan(40);
    expect(res.body.data.distance_meters).toBeLessThan(48);
    expect(res.body.data.location).toEqual({ lat: PIN.lat + 0.0004, lng: PIN.lng });
    expect(res.body.data.started_at).toBe('2026-09-14T16:00:00.000Z');

    const [row] = await prisma.$queryRaw<
      { route_customer_id: string | null; visit_type: string; notes: string }[]
    >`select route_customer_id::text, visit_type, notes from visit
      where id = ${res.body.data.id}::uuid`;
    expect(row.route_customer_id).not.toBeNull();
    expect(row.visit_type).toBe('visit');
    expect(row.notes).toBe('Owner was away, assistant attended');
  });

  it('records a check-in outside the radius flagged, not rejected', async () => {
    const stopId = await createStop();

    const res = await post({
      scheduled_visit_id: stopId,
      latitude: PIN.lat + 0.002,
      longitude: PIN.lng,
      captured_at: capturedAt('11:00:00'),
    });

    expect(res.status).toBe(201);
    expect(res.body.data.within_radius).toBe(false);
    expect(res.body.data.distance_meters).toBeGreaterThan(200);
  });

  it('is idempotent on a retry and answers 409 on a different timestamp', async () => {
    const stopId = await createStop();
    const body = {
      scheduled_visit_id: stopId,
      latitude: PIN.lat,
      longitude: PIN.lng,
      captured_at: capturedAt('12:00:00'),
    };

    const first = await post(body);
    const retry = await post(body);
    const other = await post({ ...body, captured_at: capturedAt('12:30:00') });

    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(retry.body.data.replayed).toBe(true);
    expect(other.status).toBe(409);
  });

  it('creates a single visit when the same retry arrives concurrently', async () => {
    const stopId = await createStop();
    const body = {
      scheduled_visit_id: stopId,
      latitude: PIN.lat,
      longitude: PIN.lng,
      captured_at: capturedAt('13:00:00'),
    };

    const results = await Promise.all([post(body), post(body), post(body)]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    const [{ count }] = await prisma.$queryRaw<{ count: number }[]>`
      select count(*)::int as count from visit
      where customer_id = ${customerId}::uuid
        and started_at = ${new Date('2026-09-14T19:00:00.000Z')}::timestamptz`;
    expect(count).toBe(1);
  });

  it('answers 422 when the customer has no GPS pin', async () => {
    const stopId = await createStop(noPinCustomerId);

    const res = await post({
      scheduled_visit_id: stopId,
      latitude: PIN.lat,
      longitude: PIN.lng,
      captured_at: capturedAt('14:00:00'),
    });

    expect(res.status).toBe(422);
    expect(res.body.message).toBe('Customer has no GPS location assigned');
  });

  it('answers 422 when captured_at falls on another local day', async () => {
    const stopId = await createStop();

    const res = await post({
      scheduled_visit_id: stopId,
      latitude: PIN.lat,
      longitude: PIN.lng,
      captured_at: '2026-09-15T00:30:00-06:00',
    });

    expect(res.status).toBe(422);
  });

  it("answers 403 for another seller's stop", async () => {
    const stopId = await createStop();
    await prisma.route_user.update({
      where: { id: routeUserId },
      data: { user_id: (await otherSeller()).id },
    });

    const res = await post({
      scheduled_visit_id: stopId,
      latitude: PIN.lat,
      longitude: PIN.lng,
      captured_at: capturedAt('15:00:00'),
    });

    expect(res.status).toBe(403);
    await prisma.route_user.update({
      where: { id: routeUserId },
      data: { user_id: sellerId },
    });
  });
});

const otherSeller = async () =>
  prisma.app_user.upsert({
    where: { id: '00000000-0000-4000-8000-00000000f003' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-00000000f003',
      role: ROLES.SELLER,
      name: 'Other Seller',
      active: true,
    },
  });
