import request from 'supertest';
import { AppRoutes } from '../../routes';
import { Server } from '../../server';
import { envs } from '../../../config/envs';
import { CustomError } from '../../../domain/errors/CustomError';
import { findUserByAuthUserId } from '../../../services/auth.service';
import {
  createExtraStop,
  deleteExtraStop,
  getExtraStopsDay,
} from '../../../services/extra-stop.service';

jest.mock('../../../lib/supabaseJwt', () => ({
  verifyAccessToken: jest.fn().mockResolvedValue({ sub: 'auth-user' }),
  JwksUnavailableError: class extends Error {},
  warmUpJwks: jest.fn(),
}));

jest.mock('../../../services/auth.service', () => ({
  findUserByAuthUserId: jest.fn(),
}));

// The controller opens the transaction itself; hand the callback a stub client.
jest.mock('../../../lib/prisma', () => ({
  prisma: { $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb({})) },
}));

jest.mock('../../../services/extra-stop.service', () => ({
  createExtraStop: jest.fn(),
  deleteExtraStop: jest.fn(),
  getExtraStopsDay: jest.fn(),
}));

const createExtraStopMock = createExtraStop as jest.Mock;
const deleteExtraStopMock = deleteExtraStop as jest.Mock;
const getExtraStopsDayMock = getExtraStopsDay as jest.Mock;
const findUserMock = findUserByAuthUserId as jest.Mock;

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SELLER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CUSTOMER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const STOP_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const BASE = `/api/v1/sellers/${SELLER_ID}/daily-route`;

const AUTH = {
  'x-api-key': envs.API_KEY,
  Authorization: 'Bearer token-de-prueba',
};

const user = (role: string) => ({
  id: ADMIN_ID,
  auth_user_id: 'auth-user',
  role,
  name: 'User',
  email: 'user@pragma.test',
  active: true,
  password_set_at: new Date('2026-09-11T12:00:00.000Z'),
});

const body = (overrides: Record<string, unknown> = {}) => ({
  date: '2026-09-30',
  customer_id: CUSTOMER_ID,
  stop_type: 'visit',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  findUserMock.mockResolvedValue(user('Administrador'));
  createExtraStopMock.mockResolvedValue({ id: STOP_ID, is_extra: true });
  deleteExtraStopMock.mockResolvedValue({ id: STOP_ID, deleted: true });
  getExtraStopsDayMock.mockResolvedValue({ date: '2026-09-30', routes: [], stops: [] });
});

describe('POST /api/v1/sellers/:sellerId/daily-route/extra-stops', () => {
  it('creates the extra stop and answers 201', async () => {
    const res = await request(app).post(`${BASE}/extra-stops`).set(AUTH).send(body());

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(STOP_ID);
    expect(createExtraStopMock).toHaveBeenCalledWith(expect.anything(), SELLER_ID, body());
  });

  it('forbids the Vendedor', async () => {
    findUserMock.mockResolvedValue(user('Vendedor'));

    const res = await request(app).post(`${BASE}/extra-stops`).set(AUTH).send(body());

    expect(res.status).toBe(403);
    expect(createExtraStopMock).not.toHaveBeenCalled();
  });

  it('answers 401 without a session', async () => {
    const res = await request(app)
      .post(`${BASE}/extra-stops`)
      .set({ 'x-api-key': envs.API_KEY })
      .send(body());

    expect(res.status).toBe(401);
  });

  it.each([
    ['invalid stop_type', { stop_type: 'delivery' }, 'stop_type'],
    ['bad date', { date: '30-09-2026' }, 'date'],
    ['bad customer id', { customer_id: 'nope' }, 'customer_id'],
  ])('rejects %s', async (_label, override, field) => {
    const res = await request(app)
      .post(`${BASE}/extra-stops`)
      .set(AUTH)
      .send(body(override));

    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe(field);
    expect(createExtraStopMock).not.toHaveBeenCalled();
  });

  it('rejects seller_id in the body (comes from the URL now)', async () => {
    const res = await request(app)
      .post(`${BASE}/extra-stops`)
      .set(AUTH)
      .send(body({ seller_id: SELLER_ID }));

    expect(res.status).toBe(400);
    expect(createExtraStopMock).not.toHaveBeenCalled();
  });

  it('answers 400 for a past date', async () => {
    createExtraStopMock.mockRejectedValue(
      CustomError.badRequest('date cannot be in the past', 'EXTRA_STOP_PAST_DATE')
    );

    const res = await request(app).post(`${BASE}/extra-stops`).set(AUTH).send(body());

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('date cannot be in the past');
    expect(res.body.code).toBe('EXTRA_STOP_PAST_DATE');
  });

  it('answers 422 when the customer has no GPS pin', async () => {
    createExtraStopMock.mockRejectedValue(
      CustomError.unprocessable('Customer has no GPS location', 'CUSTOMER_NO_GPS')
    );

    const res = await request(app).post(`${BASE}/extra-stops`).set(AUTH).send(body());

    expect(res.status).toBe(422);
    expect(res.body.message).toBe('Customer has no GPS location');
    expect(res.body.code).toBe('CUSTOMER_NO_GPS');
  });

  it('answers 422 when the seller has no route that day', async () => {
    createExtraStopMock.mockRejectedValue(
      CustomError.unprocessable('Seller has no route assigned on that date', 'SELLER_NO_ROUTE_ON_DATE')
    );

    const res = await request(app).post(`${BASE}/extra-stops`).set(AUTH).send(body());

    expect(res.status).toBe(422);
    expect(res.body.message).toBe('Seller has no route assigned on that date');
    expect(res.body.code).toBe('SELLER_NO_ROUTE_ON_DATE');
  });

  it('answers 422 when several routes match and route_id is missing', async () => {
    createExtraStopMock.mockRejectedValue(
      CustomError.unprocessable('Seller has more than one route on that date; route_id is required', 'ROUTE_ID_REQUIRED')
    );

    const res = await request(app).post(`${BASE}/extra-stops`).set(AUTH).send(body());

    expect(res.status).toBe(422);
    expect(res.body.message).toBe('Seller has more than one route on that date; route_id is required');
    expect(res.body.code).toBe('ROUTE_ID_REQUIRED');
  });

  it('answers 422 when route_id does not match an assignment of that day', async () => {
    createExtraStopMock.mockRejectedValue(
      CustomError.unprocessable('route_id is not assigned to this seller on that date', 'ROUTE_NOT_ASSIGNED')
    );

    const res = await request(app)
      .post(`${BASE}/extra-stops`)
      .set(AUTH)
      .send(body({ route_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }));

    expect(res.status).toBe(422);
    expect(res.body.message).toBe('route_id is not assigned to this seller on that date');
    expect(res.body.code).toBe('ROUTE_NOT_ASSIGNED');
  });

  it('resolves to the single active route when one active and one inactive assignment exist', async () => {
    createExtraStopMock.mockResolvedValue({ id: STOP_ID, is_extra: true });

    const res = await request(app).post(`${BASE}/extra-stops`).set(AUTH).send(body());

    expect(res.status).toBe(201);
    expect(createExtraStopMock).toHaveBeenCalledWith(expect.anything(), SELLER_ID, body());
  });

  it('answers 422 when all assignments on the date are inactive', async () => {
    createExtraStopMock.mockRejectedValue(
      CustomError.unprocessable('Seller has no route assigned on that date', 'SELLER_NO_ROUTE_ON_DATE')
    );

    const res = await request(app).post(`${BASE}/extra-stops`).set(AUTH).send(body());

    expect(res.status).toBe(422);
    expect(res.body.message).toBe('Seller has no route assigned on that date');
    expect(res.body.code).toBe('SELLER_NO_ROUTE_ON_DATE');
  });

  it('answers 422 when route_id points to an inactive route', async () => {
    const INACTIVE_ROUTE_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    createExtraStopMock.mockRejectedValue(
      CustomError.unprocessable('route_id is not assigned to this seller on that date', 'ROUTE_NOT_ASSIGNED')
    );

    const res = await request(app)
      .post(`${BASE}/extra-stops`)
      .set(AUTH)
      .send(body({ route_id: INACTIVE_ROUTE_ID }));

    expect(res.status).toBe(422);
    expect(res.body.message).toBe('route_id is not assigned to this seller on that date');
    expect(res.body.code).toBe('ROUTE_NOT_ASSIGNED');
  });

  it('answers 409 for a duplicate stop (pre-check or P2002 mapping)', async () => {
    createExtraStopMock.mockRejectedValue(
      CustomError.conflict('Customer already has a stop of this type on that date', 'EXTRA_STOP_DUPLICATE')
    );

    const res = await request(app).post(`${BASE}/extra-stops`).set(AUTH).send(body());

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Customer already has a stop of this type on that date');
    expect(res.body.code).toBe('EXTRA_STOP_DUPLICATE');
  });

  it('includes code in error body and error is not in 400 validation', async () => {
    createExtraStopMock.mockRejectedValue(
      CustomError.badRequest('Some error', 'SOME_CODE')
    );

    const res = await request(app).post(`${BASE}/extra-stops`).set(AUTH).send(body());

    expect(res.body).toHaveProperty('code');
    expect(res.body.code).toBe('SOME_CODE');
  });

  it('does not include code in validation 400 response', async () => {
    const res = await request(app)
      .post(`${BASE}/extra-stops`)
      .set(AUTH)
      .send(body({ date: 'invalid' }));

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('errors');
    expect(res.body).not.toHaveProperty('code');
  });
});

describe('DELETE /api/v1/sellers/:sellerId/daily-route/extra-stops/:stopId', () => {
  it('soft deletes and answers 200', async () => {
    const res = await request(app).delete(`${BASE}/extra-stops/${STOP_ID}`).set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: STOP_ID, deleted: true });
    expect(deleteExtraStopMock).toHaveBeenCalledWith(expect.anything(), SELLER_ID, STOP_ID);
  });

  it('forbids the Vendedor', async () => {
    findUserMock.mockResolvedValue(user('Vendedor'));

    const res = await request(app).delete(`${BASE}/extra-stops/${STOP_ID}`).set(AUTH);

    expect(res.status).toBe(403);
    expect(deleteExtraStopMock).not.toHaveBeenCalled();
  });

  it('answers 401 without a session', async () => {
    const res = await request(app)
      .delete(`${BASE}/extra-stops/${STOP_ID}`)
      .set({ 'x-api-key': envs.API_KEY });

    expect(res.status).toBe(401);
  });

  it('answers 409 when the stop already has a check-in', async () => {
    deleteExtraStopMock.mockRejectedValue(
      CustomError.conflict('Extra stop already has a check-in and cannot be deleted', 'EXTRA_STOP_HAS_CHECKIN')
    );

    const res = await request(app).delete(`${BASE}/extra-stops/${STOP_ID}`).set(AUTH);

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Extra stop already has a check-in and cannot be deleted');
    expect(res.body.code).toBe('EXTRA_STOP_HAS_CHECKIN');
  });

  it('answers 422 when the stop is dated in the past', async () => {
    deleteExtraStopMock.mockRejectedValue(
      CustomError.unprocessable('Extra stops dated in the past cannot be deleted', 'EXTRA_STOP_DELETE_PAST')
    );

    const res = await request(app).delete(`${BASE}/extra-stops/${STOP_ID}`).set(AUTH);

    expect(res.status).toBe(422);
    expect(res.body.message).toBe('Extra stops dated in the past cannot be deleted');
    expect(res.body.code).toBe('EXTRA_STOP_DELETE_PAST');
  });

  it('answers 404 for a missing, non-extra, or other seller stop', async () => {
    deleteExtraStopMock.mockRejectedValue(
      CustomError.notFound('Extra stop not found', 'EXTRA_STOP_NOT_FOUND')
    );

    const res = await request(app).delete(`${BASE}/extra-stops/${STOP_ID}`).set(AUTH);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Extra stop not found');
    expect(res.body.code).toBe('EXTRA_STOP_NOT_FOUND');
  });
});

describe('GET /api/v1/sellers/:sellerId/daily-route', () => {
  it('returns the seller day with is_extra stops', async () => {
    getExtraStopsDayMock.mockResolvedValue({
      date: '2026-09-30',
      routes: [],
      stops: [{ id: 'stop-1', is_extra: true, completed_at: null }],
    });

    const res = await request(app).get(BASE).query({ date: '2026-09-30' }).set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data.stops[0].is_extra).toBe(true);
    expect(getExtraStopsDayMock).toHaveBeenCalledWith(
      expect.anything(),
      SELLER_ID,
      '2026-09-30'
    );
  });

  it('lists active route assignments even with zero stops', async () => {
    const ROUTE_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const ROUTE_USER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    getExtraStopsDayMock.mockResolvedValue({
      date: '2026-09-30',
      routes: [
        {
          id: ROUTE_ID,
          route_user_id: ROUTE_USER_ID,
          name: 'Zona Escalón',
          municipality: 'San Salvador',
          zone: 'Zona 1',
        },
      ],
      stops: [],
    });

    const res = await request(app).get(BASE).query({ date: '2026-09-30' }).set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data.routes).toHaveLength(1);
    expect(res.body.data.routes[0].name).toBe('Zona Escalón');
    expect(res.body.data.stops).toHaveLength(0);
  });

  it('includes route with stops and does not duplicate', async () => {
    const ROUTE_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const ROUTE_USER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    getExtraStopsDayMock.mockResolvedValue({
      date: '2026-09-30',
      routes: [
        {
          id: ROUTE_ID,
          route_user_id: ROUTE_USER_ID,
          name: 'Zona Escalón',
          municipality: 'San Salvador',
          zone: 'Zona 1',
        },
      ],
      stops: [
        {
          id: 'stop-1',
          route: { id: ROUTE_ID, name: 'Zona Escalón' },
          is_extra: false,
          completed_at: null,
        },
      ],
    });

    const res = await request(app).get(BASE).query({ date: '2026-09-30' }).set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data.routes).toHaveLength(1);
    expect(res.body.data.stops).toHaveLength(1);
  });

  it('forbids the Vendedor', async () => {
    findUserMock.mockResolvedValue(user('Vendedor'));

    const res = await request(app).get(BASE).set(AUTH);

    expect(res.status).toBe(403);
    expect(getExtraStopsDayMock).not.toHaveBeenCalled();
  });

  it('answers 401 without a session', async () => {
    const res = await request(app).get(BASE).set({ 'x-api-key': envs.API_KEY });

    expect(res.status).toBe(401);
  });

  it('answers 404 for an invalid seller', async () => {
    getExtraStopsDayMock.mockRejectedValue(CustomError.notFound('Seller not found', 'SELLER_NOT_FOUND'));

    const res = await request(app).get(BASE).set(AUTH);

    expect(res.status).toBe(404);
  });
});
