import request from 'supertest';
import { AppRoutes } from '../../routes';
import { Server } from '../../server';
import { envs } from '../../../config/envs';
import { CustomError } from '../../../domain/errors/CustomError';
import { confirmVisit } from '../../../services/visit.service';
import { findUserByAuthUserId } from '../../../services/auth.service';

jest.mock('../../../lib/supabaseJwt', () => ({
  verifyAccessToken: jest.fn().mockResolvedValue({ sub: 'auth-seller' }),
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

jest.mock('../../../services/visit.service', () => ({
  confirmVisit: jest.fn(),
}));

const confirmVisitMock = confirmVisit as jest.Mock;
const findUserMock = findUserByAuthUserId as jest.Mock;

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

const AUTH = {
  'x-api-key': envs.API_KEY,
  Authorization: 'Bearer token-de-prueba',
};

const SELLER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STOP_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const user = (role: string) => ({
  id: SELLER_ID,
  auth_user_id: 'auth-seller',
  role,
  name: 'Seller',
  email: 'seller@pragma.test',
  active: true,
  password_set_at: new Date('2026-09-11T12:00:00.000Z'),
});

const body = (overrides: Record<string, unknown> = {}) => ({
  scheduled_visit_id: STOP_ID,
  latitude: 13.7,
  longitude: -89.2,
  captured_at: '2026-09-21T14:05:00-06:00',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  findUserMock.mockResolvedValue(user('Vendedor'));
  confirmVisitMock.mockResolvedValue({ id: 'visit-1', replayed: false });
});

describe('POST /api/v1/visits', () => {
  it('creates the visit and answers 201', async () => {
    const res = await request(app).post('/api/v1/visits').set(AUTH).send(body());

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe('visit-1');
  });

  it('answers 200 when the stop was already confirmed', async () => {
    confirmVisitMock.mockResolvedValue({ id: 'visit-1', replayed: true });

    const res = await request(app).post('/api/v1/visits').set(AUTH).send(body());

    expect(res.status).toBe(200);
  });

  it('passes the authenticated seller, not an id from the body', async () => {
    await request(app)
      .post('/api/v1/visits')
      .set(AUTH)
      .send(body({ user_id: 'someone-else' }));

    expect(confirmVisitMock).toHaveBeenCalledWith(
      expect.anything(),
      SELLER_ID,
      expect.not.objectContaining({ user_id: expect.anything() })
    );
  });

  it('parses captured_at into a Date keeping its instant', async () => {
    await request(app).post('/api/v1/visits').set(AUTH).send(body());

    const input = confirmVisitMock.mock.calls[0][2];
    expect(input.captured_at).toEqual(new Date('2026-09-21T20:05:00.000Z'));
  });

  it('forbids the Administrador', async () => {
    findUserMock.mockResolvedValue(user('Administrador'));

    const res = await request(app).post('/api/v1/visits').set(AUTH).send(body());

    expect(res.status).toBe(403);
    expect(confirmVisitMock).not.toHaveBeenCalled();
  });

  it('answers 401 without a session', async () => {
    const res = await request(app)
      .post('/api/v1/visits')
      .set({ 'x-api-key': envs.API_KEY })
      .send(body());

    expect(res.status).toBe(401);
  });

  it.each([
    ['latitude out of range', { latitude: 91 }, 'latitude'],
    ['longitude out of range', { longitude: -181 }, 'longitude'],
    ['captured_at without offset', { captured_at: '2026-09-21T14:05:00' }, 'captured_at'],
    ['captured_at not a date', { captured_at: 'yesterday' }, 'captured_at'],
    ['bad stop id', { scheduled_visit_id: 'nope' }, 'scheduled_visit_id'],
    [
      'finished_at before captured_at',
      { finished_at: '2026-09-21T14:00:00-06:00' },
      'finished_at',
    ],
  ])('rejects %s', async (_label, override, field) => {
    const res = await request(app)
      .post('/api/v1/visits')
      .set(AUTH)
      .send(body(override));

    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe(field);
    expect(confirmVisitMock).not.toHaveBeenCalled();
  });

  it('maps service errors to their status', async () => {
    confirmVisitMock.mockRejectedValue(CustomError.conflict('This stop was already confirmed'));

    const res = await request(app).post('/api/v1/visits').set(AUTH).send(body());

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('This stop was already confirmed');
  });
});
