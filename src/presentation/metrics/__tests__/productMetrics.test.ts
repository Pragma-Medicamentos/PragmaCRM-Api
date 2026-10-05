import request from 'supertest';
import { AppRoutes } from '../../routes';
import { Server } from '../../server';
import { envs } from '../../../config/envs';
import { CustomError } from '../../../domain/errors/CustomError';
import { findUserByAuthUserId } from '../../../services/auth.service';
import {
  getProductDetail,
  getProductsWithoutMovement,
} from '../../../services/productMetrics.service';

// Product metrics are part of the admin-only panel (RF-09). The auth chain is
// stubbed so these tests exercise the HTTP layer, not token verification.
jest.mock('../../../lib/supabaseJwt', () => ({
  verifyAccessToken: jest.fn().mockResolvedValue({ sub: 'auth-admin' }),
  JwksUnavailableError: class extends Error {},
  warmUpJwks: jest.fn(),
}));

jest.mock('../../../services/auth.service', () => ({
  findUserByAuthUserId: jest.fn(),
}));

jest.mock('../../../services/productMetrics.service', () => ({
  getProductDetail: jest.fn(),
  getProductsWithoutMovement: jest.fn(),
}));

const findUserMock = findUserByAuthUserId as jest.Mock;
const getProductDetailMock = getProductDetail as jest.Mock;
const getProductsWithoutMovementMock = getProductsWithoutMovement as jest.Mock;

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

const AUTH = {
  'x-api-key': envs.API_KEY,
  Authorization: 'Bearer token-de-prueba',
};

const userWithRole = (role: string) => ({
  id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  auth_user_id: 'auth-admin',
  role,
  name: 'Admin',
  email: 'admin@pragma.test',
  active: true,
  password_set_at: new Date('2026-09-11T12:00:00.000Z'),
});

const context = {
  period: { from: '2026-09-01', to: '2026-09-30' },
  thresholds: { inactivity_days: 30, credit_term_days: 60, gps_radius_meters: 80 },
};

beforeEach(() => {
  jest.clearAllMocks();
  findUserMock.mockResolvedValue(userWithRole('Administrador'));
  getProductDetailMock.mockResolvedValue({
    ...context,
    product: { product_id: 42, code: 'ABC-1', name: 'Producto X', product_group: null },
    amount: '1500.00',
    units: '120.0000',
    position: 1,
    share_percent: 30,
    period_total_amount: '5000.00',
    invoices: 12,
    average_ticket: '125.00',
    customers: 9,
    portfolio_customers: 45,
    penetration_percent: 20,
    abc_class: 'A',
    trend: {
      previous_period: { from: '2026-08-02', to: '2026-08-31' },
      previous_amount: '1200.00',
      change_percent: 25,
    },
    sellers: [],
  });
  getProductsWithoutMovementMock.mockResolvedValue({
    ...context,
    active_products: 310,
    products: [],
    without_movement: { days_30: 120, days_60: 80, days_90: 55 },
  });
});

describe('GET /api/v1/metrics/products/:id', () => {
  it('returns the product sheet for the requested range', async () => {
    const res = await request(app)
      .get('/api/v1/metrics/products/42?from=2026-09-01&to=2026-09-30')
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data.product.product_id).toBe(42);
    expect(res.body.data.abc_class).toBe('A');
    expect(getProductDetailMock).toHaveBeenCalledWith(
      expect.anything(),
      42,
      expect.objectContaining({ from: '2026-09-01', to: '2026-09-30' })
    );
  });

  it('passes the id as a number, not as the raw path segment', async () => {
    await request(app).get('/api/v1/metrics/products/42').set(AUTH);

    expect(getProductDetailMock.mock.calls[0][1]).toBe(42);
  });

  it.each(['abc', '0', '-3', '1.5'])('rejects id=%s with 400', async (id) => {
    const res = await request(app).get(`/api/v1/metrics/products/${id}`).set(AUTH);

    expect(res.status).toBe(400);
    expect(getProductDetailMock).not.toHaveBeenCalled();
  });

  it('propagates the 404 of an unknown product', async () => {
    getProductDetailMock.mockRejectedValue(CustomError.notFound('Product 999 not found'));

    const res = await request(app).get('/api/v1/metrics/products/999').set(AUTH);

    expect(res.status).toBe(404);
  });

  it('rejects a Vendedor', async () => {
    findUserMock.mockResolvedValue(userWithRole('Vendedor'));

    const res = await request(app).get('/api/v1/metrics/products/42').set(AUTH);

    expect(res.status).toBe(403);
    expect(getProductDetailMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/metrics/products/no-movement', () => {
  it('is not captured by /products/:id', async () => {
    const res = await request(app).get('/api/v1/metrics/products/no-movement').set(AUTH);

    expect(res.status).toBe(200);
    expect(getProductsWithoutMovementMock).toHaveBeenCalled();
    expect(getProductDetailMock).not.toHaveBeenCalled();
  });

  it('returns the quiet catalog with its 30/60/90 counts', async () => {
    const res = await request(app)
      .get('/api/v1/metrics/products/no-movement?from=2026-09-01&to=2026-09-30')
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data.active_products).toBe(310);
    expect(res.body.data.without_movement).toEqual({ days_30: 120, days_60: 80, days_90: 55 });
  });

  it('rejects an invalid range with 400', async () => {
    const res = await request(app)
      .get('/api/v1/metrics/products/no-movement?from=2026-09-30&to=2026-09-01')
      .set(AUTH);

    expect(res.status).toBe(400);
    expect(getProductsWithoutMovementMock).not.toHaveBeenCalled();
  });
});
