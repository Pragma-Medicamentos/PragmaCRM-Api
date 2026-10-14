import request from 'supertest';
import { AppRoutes } from '../../routes';
import { Server } from '../../server';
import { envs } from '../../../config/envs';
import { CustomError } from '../../../domain/errors/CustomError';
import { findUserByAuthUserId } from '../../../services/auth.service';
import { getExecutedRoutes } from '../../../services/executed-route.service';

jest.mock('../../../lib/supabaseJwt', () => ({
  verifyAccessToken: jest.fn().mockResolvedValue({ sub: 'auth-user' }),
  JwksUnavailableError: class extends Error {},
  warmUpJwks: jest.fn(),
}));

jest.mock('../../../services/auth.service', () => ({
  findUserByAuthUserId: jest.fn(),
}));

jest.mock('../../../lib/prisma', () => ({ prisma: {} }));

jest.mock('../../../services/executed-route.service', () => ({
  getExecutedRoutes: jest.fn(),
}));

const getExecutedRoutesMock = getExecutedRoutes as jest.Mock;
const findUserMock = findUserByAuthUserId as jest.Mock;

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

const SELLER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BASE = '/api/v1/executed-routes';

const AUTH = {
  'x-api-key': envs.API_KEY,
  Authorization: 'Bearer token-de-prueba',
};

const user = (role: string) => ({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  auth_user_id: 'auth-user',
  role,
  name: 'User',
  email: 'user@pragma.test',
  active: true,
  password_set_at: new Date('2026-09-11T12:00:00.000Z'),
});

beforeEach(() => {
  jest.clearAllMocks();
  findUserMock.mockResolvedValue(user('Administrador'));
  getExecutedRoutesMock.mockResolvedValue({ from: '2026-10-01', to: '2026-10-31', routes: [] });
});

describe('GET /api/v1/executed-routes', () => {
  it('returns the history and forwards the filters', async () => {
    const res = await request(app)
      .get(BASE)
      .query({ from: '2026-10-01', to: '2026-10-07', seller_id: SELLER_ID })
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ from: '2026-10-01', to: '2026-10-31', routes: [] });
    expect(getExecutedRoutesMock).toHaveBeenCalledWith(expect.anything(), {
      from: '2026-10-01',
      to: '2026-10-07',
      seller_id: SELLER_ID,
    });
  });

  it('rejects a reversed range with 400', async () => {
    const res = await request(app).get(BASE).query({ from: '2026-10-10', to: '2026-10-01' }).set(AUTH);

    expect(res.status).toBe(400);
    expect(getExecutedRoutesMock).not.toHaveBeenCalled();
  });

  it('rejects a range longer than 92 days with 400', async () => {
    const res = await request(app).get(BASE).query({ from: '2026-01-01', to: '2026-06-01' }).set(AUTH);

    expect(res.status).toBe(400);
  });

  it('rejects an invalid seller_id with 400', async () => {
    const res = await request(app).get(BASE).query({ seller_id: 'nope' }).set(AUTH);

    expect(res.status).toBe(400);
  });

  it('maps a missing seller to 404', async () => {
    getExecutedRoutesMock.mockRejectedValue(CustomError.notFound('Seller not found'));

    const res = await request(app).get(BASE).query({ seller_id: SELLER_ID }).set(AUTH);

    expect(res.status).toBe(404);
  });

  it('forbids a Vendedor', async () => {
    findUserMock.mockResolvedValue(user('Vendedor'));

    const res = await request(app).get(BASE).set(AUTH);

    expect(res.status).toBe(403);
    expect(getExecutedRoutesMock).not.toHaveBeenCalled();
  });
});
