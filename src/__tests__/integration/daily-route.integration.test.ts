import request from 'supertest';
import { verifyAccessToken } from '../../lib/supabaseJwt';
import { prisma } from '../../lib/prisma';
import { AppRoutes } from '../../presentation/routes';
import { Server } from '../../presentation/server';
import { envs } from '../../config/envs';
import { ROLES } from '../../domain/types/auth.types';

/**
 * Daily route profile fields and the seller's "set location" (PCRM-160)
 * against real Postgres/PostGIS: the unit tests can only mock the raw SQL.
 * Runs on the local Supabase database (loadEnv.ts forces .env.test). Token
 * verification is mocked.
 */

jest.mock('../../lib/supabaseJwt', () => ({
  verifyAccessToken: jest.fn(),
  JwksUnavailableError: class extends Error {},
  warmUpJwks: jest.fn(),
}));

const verifyAccessTokenMock = verifyAccessToken as unknown as jest.Mock;

const SELLER_AUTH_ID = 'e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3';
const OTHER_AUTH_ID = 'e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4';
const HEADERS = { 'x-api-key': envs.API_KEY, Authorization: 'Bearer test' };
const PLANNED_DAY = '2026-09-14';

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

let sellerId: string;
let otherSellerId: string;
let customerId: string;
let prospectId: string;
let routeId: string;
let routeUserId: string;
let otherRouteUserId: string;

const createStop = async (
  target: { customer_id?: string; prospect_id?: string },
  onRouteUser = routeUserId
) =>
  (
    await prisma.scheduled_visit.create({
      data: {
        route_user_id: onRouteUser,
        visit_date: new Date(`${PLANNED_DAY}T00:00:00.000Z`),
        ...target,
      },
    })
  ).id;

const setLocation = (stopId: string, body: Record<string, unknown>) =>
  request(app)
    .patch(`/api/v1/me/route/stops/${stopId}/location`)
    .set(HEADERS)
    .send(body);

const customerPin = async () => {
  const [row] = await prisma.$queryRaw<{ lat: number | null; lng: number | null }[]>`
    select extensions.st_y(location::extensions.geometry)::float8 as lat,
           extensions.st_x(location::extensions.geometry)::float8 as lng
    from customer where id = ${customerId}::uuid`;
  return row;
};

beforeAll(async () => {
  for (const [authId, email] of [
    [SELLER_AUTH_ID, 'route-seller@pragma.test'],
    [OTHER_AUTH_ID, 'route-other@pragma.test'],
  ]) {
    await prisma.$executeRaw`
      insert into auth.users (id, instance_id, aud, role, email)
      values (
        ${authId}::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid,
        'authenticated', 'authenticated', ${email}
      )
      on conflict (id) do nothing`;
  }

  sellerId = (
    await prisma.app_user.create({
      data: {
        auth_user_id: SELLER_AUTH_ID,
        role: ROLES.SELLER,
        name: 'Route Test Seller',
        email: 'route-seller@pragma.test',
        active: true,
      },
    })
  ).id;
  otherSellerId = (
    await prisma.app_user.create({
      data: {
        auth_user_id: OTHER_AUTH_ID,
        role: ROLES.SELLER,
        name: 'Route Test Other Seller',
        email: 'route-other@pragma.test',
        active: true,
      },
    })
  ).id;

  customerId = (
    await prisma.customer.create({
      data: {
        name: 'Route Test Customer',
        personality: 'rojo',
        potential: 'alto',
        establishment_type: 'Farmacia',
        credit_limit: 1500.5,
      },
    })
  ).id;
  prospectId = (
    await prisma.prospect.create({
      data: { name: 'Route Test Prospect', user_id: sellerId },
    })
  ).id;

  routeId = (await prisma.route.create({ data: { name: 'Route Test Route' } })).id;
  routeUserId = (
    await prisma.route_user.create({
      data: { route_id: routeId, user_id: sellerId, day: 1 },
    })
  ).id;
  otherRouteUserId = (
    await prisma.route_user.create({
      data: { route_id: routeId, user_id: otherSellerId, day: 2 },
    })
  ).id;
});

beforeEach(async () => {
  verifyAccessTokenMock.mockResolvedValue({ sub: SELLER_AUTH_ID });
  await prisma.$executeRaw`update customer set location = null where id = ${customerId}::uuid`;
  await prisma.$executeRaw`
    delete from scheduled_visit
    where route_user_id in (${routeUserId}::uuid, ${otherRouteUserId}::uuid)`;
});

afterAll(async () => {
  await prisma.$executeRaw`
    delete from scheduled_visit
    where route_user_id in (${routeUserId}::uuid, ${otherRouteUserId}::uuid)`;
  await prisma.$executeRaw`
    delete from route_user where id in (${routeUserId}::uuid, ${otherRouteUserId}::uuid)`;
  await prisma.$executeRaw`delete from route where id = ${routeId}::uuid`;
  await prisma.$executeRaw`delete from prospect where id = ${prospectId}::uuid`;
  await prisma.$executeRaw`delete from customer where id = ${customerId}::uuid`;
  await prisma.$executeRaw`
    delete from app_user where id in (${sellerId}::uuid, ${otherSellerId}::uuid)`;
  await prisma.$executeRaw`
    delete from auth.users where id in (${SELLER_AUTH_ID}::uuid, ${OTHER_AUTH_ID}::uuid)`;
  await prisma.$disconnect();
});

describe('GET /api/v1/me/route — commercial profile (real Postgres)', () => {
  it('returns the customer profile fields, with credit_limit as a number', async () => {
    await createStop({ customer_id: customerId });

    const res = await request(app)
      .get('/api/v1/me/route')
      .query({ date: PLANNED_DAY })
      .set(HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.data.stops[0]).toMatchObject({
      personality: 'rojo',
      potential: 'alto',
      establishment_type: 'Farmacia',
      credit_limit: 1500.5,
    });
  });

  it('returns them as null on a prospect stop', async () => {
    await createStop({ prospect_id: prospectId });

    const res = await request(app)
      .get('/api/v1/me/route')
      .query({ date: PLANNED_DAY })
      .set(HEADERS);

    expect(res.body.data.stops[0]).toMatchObject({
      target_kind: 'prospect',
      personality: null,
      potential: null,
      establishment_type: null,
      credit_limit: null,
    });
  });
});

describe('PATCH /api/v1/me/route/stops/:id/location (real PostGIS)', () => {
  const body = { latitude: 13.71, longitude: -89.21, accuracy_meters: 10 };

  it('writes the empty pin once, then answers 409 without moving it', async () => {
    const stopId = await createStop({ customer_id: customerId });

    const first = await setLocation(stopId, body);
    const second = await setLocation(stopId, { ...body, latitude: 13.8 });

    expect(first.status).toBe(200);
    expect(first.body.data).toEqual({
      customer_id: customerId,
      location: { lat: 13.71, lng: -89.21 },
    });
    expect(second.status).toBe(409);
    expect(await customerPin()).toEqual({ lat: 13.71, lng: -89.21 });
  });

  it('lets exactly one of two concurrent requests write the pin', async () => {
    const stopId = await createStop({ customer_id: customerId });

    const results = await Promise.all([
      setLocation(stopId, body),
      setLocation(stopId, { ...body, latitude: 13.8 }),
    ]);

    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
  });

  it('the new pin shows up in the daily route', async () => {
    const stopId = await createStop({ customer_id: customerId });

    await setLocation(stopId, body);
    const res = await request(app)
      .get('/api/v1/me/route')
      .query({ date: PLANNED_DAY })
      .set(HEADERS);

    expect(res.body.data.stops[0].location).toEqual({ lat: 13.71, lng: -89.21 });
  });

  it('answers 403 on another seller stop and leaves the pin empty', async () => {
    const stopId = await createStop({ customer_id: customerId }, otherRouteUserId);

    const res = await setLocation(stopId, body);

    expect(res.status).toBe(403);
    expect(await customerPin()).toEqual({ lat: null, lng: null });
  });

  it('answers 422 on a prospect stop', async () => {
    const stopId = await createStop({ prospect_id: prospectId });

    const res = await setLocation(stopId, body);

    expect(res.status).toBe(422);
  });

  it('answers 422 when the reading is coarser than the radius', async () => {
    const stopId = await createStop({ customer_id: customerId });

    const res = await setLocation(stopId, { ...body, accuracy_meters: 150 });

    expect(res.status).toBe(422);
    expect(await customerPin()).toEqual({ lat: null, lng: null });
  });
});
