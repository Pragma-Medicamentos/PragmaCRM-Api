import request from 'supertest';
import { AppRoutes } from '../../routes';
import { Server } from '../../server';
import { envs } from '../../../config/envs';
import { CustomError } from '../../../domain/errors/CustomError';
import { findUserByAuthUserId } from '../../../services/auth.service';
import { getSalesComparison } from '../../../services/salesComparison.service';

// Part of the admin-only metrics panel. The auth chain is stubbed so these
// tests exercise the HTTP layer; the SQL is covered by the integration test.
jest.mock('../../../lib/supabaseJwt', () => ({
  verifyAccessToken: jest.fn().mockResolvedValue({ sub: 'auth-admin' }),
  JwksUnavailableError: class extends Error {},
  warmUpJwks: jest.fn(),
}));

jest.mock('../../../services/auth.service', () => ({
  findUserByAuthUserId: jest.fn(),
}));

jest.mock('../../../services/salesComparison.service', () => ({
  getSalesComparison: jest.fn(),
}));

const findUserMock = findUserByAuthUserId as jest.Mock;
const getSalesComparisonMock = getSalesComparison as jest.Mock;

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

const AUTH = {
  'x-api-key': envs.API_KEY,
  Authorization: 'Bearer token-de-prueba',
};
const URL = '/api/v1/metrics/sales/comparison';
const CUSTOMER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SELLER_ID = '11111111-1111-1111-8111-111111111101';

const userWithRole = (role: string) => ({
  id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  auth_user_id: 'auth-admin',
  role,
  name: 'Admin',
  email: 'admin@pragma.test',
  active: true,
  password_set_at: new Date('2026-09-11T12:00:00.000Z'),
});

const figures = { total_sales: '0.00', orders_count: 0, average_ticket: null };
const response = {
  period: { from: '2026-09-01', to: '2026-09-30' },
  thresholds: { inactivity_days: 30, credit_term_days: 60, gps_radius_meters: 80 },
  previous_period: { from: '2026-08-02', to: '2026-08-31' },
  filters: { customer_id: null, user_id: null },
  totals: {
    current: figures,
    previous: figures,
    variation: {
      total_sales: { amount: '0.00', pct: null },
      orders_count: { amount: 0, pct: null },
      average_ticket: { amount: null, pct: null },
    },
  },
  breakdown: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  findUserMock.mockResolvedValue(userWithRole('Administrador'));
  getSalesComparisonMock.mockResolvedValue(response);
});

describe('GET /api/v1/metrics/sales/comparison', () => {
  it('answers 200 with the comparison', async () => {
    const res = await request(app).get(URL).set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data.previous_period).toEqual(response.previous_period);
  });

  it('passes the parsed filters, group_by and paging to the service', async () => {
    await request(app)
      .get(URL)
      .query({
        from: '2026-09-01',
        to: '2026-09-30',
        customer_id: CUSTOMER_ID,
        user_id: SELLER_ID,
        group_by: 'seller',
        page: '2',
        limit: '5',
      })
      .set(AUTH);

    expect(getSalesComparisonMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        from: '2026-09-01',
        to: '2026-09-30',
        customer_id: CUSTOMER_ID,
        user_id: SELLER_ID,
        group_by: 'seller',
        page: 2,
        limit: 5,
      })
    );
  });

  it('defaults page and limit like every listing', async () => {
    await request(app).get(URL).query({ group_by: 'customer' }).set(AUTH);

    expect(getSalesComparisonMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ page: 1, limit: 20 })
    );
  });

  it.each([
    [{ customer_id: 'abc' }, 'customer_id'],
    [{ user_id: 'abc' }, 'user_id'],
    [{ group_by: 'route' }, 'group_by'],
    [{ from: '2026-09-30', to: '2026-09-01' }, 'from'],
    [{ from: '2025-01-01', to: '2026-09-30' }, 'to'],
    [{ limit: '101' }, 'limit'],
  ])('rejects %j with 400 on %s', async (query, field) => {
    const res = await request(app).get(URL).query(query).set(AUTH);

    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe(field);
    expect(getSalesComparisonMock).not.toHaveBeenCalled();
  });

  it('maps an unknown filter id to 404', async () => {
    getSalesComparisonMock.mockRejectedValue(CustomError.notFound('Customer not found'));

    const res = await request(app).get(URL).query({ customer_id: CUSTOMER_ID }).set(AUTH);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Customer not found');
  });

  it('forbids the Vendedor', async () => {
    findUserMock.mockResolvedValue(userWithRole('Vendedor'));

    const res = await request(app).get(URL).set(AUTH);

    expect(res.status).toBe(403);
    expect(getSalesComparisonMock).not.toHaveBeenCalled();
  });

  it('answers 401 without a session', async () => {
    const res = await request(app).get(URL).set('x-api-key', envs.API_KEY);

    expect(res.status).toBe(401);
  });
});
