import request from 'supertest';
import { AppRoutes } from '../../routes';
import { Server } from '../../server';
import { envs } from '../../../config/envs';
import { CustomError } from '../../../domain/errors/CustomError';
import { findUserByAuthUserId } from '../../../services/auth.service';
import {
  getRouteMetricsDetail,
  getRouteWorkdayComparison,
  listRouteMetrics,
} from '../../../services/routeMetrics.service';

// Route metrics are part of the admin-only panel (RF-09). The auth chain is
// stubbed so these tests exercise the HTTP layer, not token verification.
jest.mock('../../../lib/supabaseJwt', () => ({
  verifyAccessToken: jest.fn().mockResolvedValue({ sub: 'auth-admin' }),
  JwksUnavailableError: class extends Error {},
  warmUpJwks: jest.fn(),
}));

jest.mock('../../../services/auth.service', () => ({
  findUserByAuthUserId: jest.fn(),
}));

jest.mock('../../../services/routeMetrics.service', () => ({
  getRouteMetricsDetail: jest.fn(),
  getRouteWorkdayComparison: jest.fn(),
  listRouteMetrics: jest.fn(),
}));

const findUserMock = findUserByAuthUserId as jest.Mock;
const listRouteMetricsMock = listRouteMetrics as jest.Mock;
const getRouteMetricsDetailMock = getRouteMetricsDetail as jest.Mock;
const getRouteWorkdayComparisonMock = getRouteWorkdayComparison as jest.Mock;

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

const AUTH = {
  'x-api-key': envs.API_KEY,
  Authorization: 'Bearer token-de-prueba',
};

const ROUTE_ID = '22222222-2222-2222-2222-222222222201';

const userWithRole = (role: string) => ({
  id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  auth_user_id: 'auth-admin',
  role,
  name: 'Admin',
  email: 'admin@pragma.test',
  active: true,
  password_set_at: new Date('2026-09-11T12:00:00.000Z'),
});

beforeEach(() => {
  jest.clearAllMocks();
  findUserMock.mockResolvedValue(userWithRole('Administrador'));
  listRouteMetricsMock.mockResolvedValue({ routes: [], total_amount: '0.00' });
  getRouteMetricsDetailMock.mockResolvedValue({ route: { route_id: ROUTE_ID } });
  getRouteWorkdayComparisonMock.mockResolvedValue({ route: { route_id: ROUTE_ID }, workdays: [] });
});

describe('GET /api/v1/metrics/routes', () => {
  it('passes the range to the service', async () => {
    const res = await request(app).get('/api/v1/metrics/routes?from=2026-09-01&to=2026-09-30').set(AUTH);

    expect(res.status).toBe(200);
    expect(listRouteMetricsMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ from: '2026-09-01', to: '2026-09-30' })
    );
  });

  it('rejects an inverted range with 400', async () => {
    const res = await request(app).get('/api/v1/metrics/routes?from=2026-09-30&to=2026-09-01').set(AUTH);

    expect(res.status).toBe(400);
    expect(listRouteMetricsMock).not.toHaveBeenCalled();
  });

  it('rejects a Vendedor', async () => {
    findUserMock.mockResolvedValue(userWithRole('Vendedor'));

    const res = await request(app).get('/api/v1/metrics/routes').set(AUTH);

    expect(res.status).toBe(403);
    expect(listRouteMetricsMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/metrics/routes/:id', () => {
  it('returns the detail of the route', async () => {
    const res = await request(app).get(`/api/v1/metrics/routes/${ROUTE_ID}`).set(AUTH);

    expect(res.status).toBe(200);
    expect(getRouteMetricsDetailMock.mock.calls[0][1]).toBe(ROUTE_ID);
  });

  it('rejects an id that is not a uuid with 400', async () => {
    const res = await request(app).get('/api/v1/metrics/routes/42').set(AUTH);

    expect(res.status).toBe(400);
    expect(getRouteMetricsDetailMock).not.toHaveBeenCalled();
  });

  it('propagates the 404 of an unknown route', async () => {
    getRouteMetricsDetailMock.mockRejectedValue(CustomError.notFound('Route not found'));

    const res = await request(app).get(`/api/v1/metrics/routes/${ROUTE_ID}`).set(AUTH);

    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/metrics/routes/:id/workdays', () => {
  it('passes the day and the limit to the service', async () => {
    const res = await request(app)
      .get(`/api/v1/metrics/routes/${ROUTE_ID}/workdays?day=2&limit=4`)
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(getRouteWorkdayComparisonMock).toHaveBeenCalledWith(expect.anything(), ROUTE_ID, {
      day: 2,
      limit: 4,
    });
  });

  it('defaults the limit and leaves the day to the service', async () => {
    const res = await request(app).get(`/api/v1/metrics/routes/${ROUTE_ID}/workdays`).set(AUTH);

    expect(res.status).toBe(200);
    expect(getRouteWorkdayComparisonMock.mock.calls[0][2]).toEqual({ limit: 5 });
  });

  it.each(['day=0', 'day=8', 'limit=1', 'limit=13'])('rejects %s with 400', async (param) => {
    const res = await request(app)
      .get(`/api/v1/metrics/routes/${ROUTE_ID}/workdays?${param}`)
      .set(AUTH);

    expect(res.status).toBe(400);
    expect(getRouteWorkdayComparisonMock).not.toHaveBeenCalled();
  });

  it('propagates the 404 of an unknown route', async () => {
    getRouteWorkdayComparisonMock.mockRejectedValue(CustomError.notFound('Route not found'));

    const res = await request(app).get(`/api/v1/metrics/routes/${ROUTE_ID}/workdays`).set(AUTH);

    expect(res.status).toBe(404);
  });
});
