import request from 'supertest';
import { AppRoutes } from '../../routes';
import { Server } from '../../server';
import { envs } from '../../../config/envs';
import { findUserByAuthUserId } from '../../../services/auth.service';
import {
  getCompanyKpis,
  getCoverage,
  getPurchaseFrequency,
  getSellerDetail,
  getTrends,
  listSellerPerformance,
} from '../../../services/metrics.service';

// The metrics panel is admin-only (RF-09). The auth chain is stubbed so these
// tests exercise the HTTP layer, not token verification.
jest.mock('../../../lib/supabaseJwt', () => ({
  verifyAccessToken: jest.fn().mockResolvedValue({ sub: 'auth-admin' }),
  JwksUnavailableError: class extends Error {},
  warmUpJwks: jest.fn(),
}));

jest.mock('../../../services/auth.service', () => ({
  findUserByAuthUserId: jest.fn(),
}));

jest.mock('../../../services/metrics.service', () => ({
  getCompanyKpis: jest.fn(),
  listSellerPerformance: jest.fn(),
  getSellerDetail: jest.fn(),
  getTrends: jest.fn(),
  getCoverage: jest.fn(),
  getPurchaseFrequency: jest.fn(),
}));

const findUserMock = findUserByAuthUserId as jest.Mock;
const getCompanyKpisMock = getCompanyKpis as jest.Mock;
const getSellerDetailMock = getSellerDetail as jest.Mock;
const getTrendsMock = getTrends as jest.Mock;

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

const AUTH = {
  'x-api-key': envs.API_KEY,
  Authorization: 'Bearer token-de-prueba',
};

const SELLER_ID = '11111111-1111-1111-1111-111111111101';

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
  getCompanyKpisMock.mockResolvedValue({ ...context, kpis: {} });
  (listSellerPerformance as jest.Mock).mockResolvedValue({ ...context, sellers: [] });
  getSellerDetailMock.mockResolvedValue({ ...context, seller: {} });
  getTrendsMock.mockResolvedValue({ ...context, granularity: 'week', points: [] });
  (getCoverage as jest.Mock).mockResolvedValue({ ...context, customers: [] });
  (getPurchaseFrequency as jest.Mock).mockResolvedValue({ ...context, buckets: [] });
});

describe('metrics access control', () => {
  it('rejects a request without a token', async () => {
    const res = await request(app)
      .get('/api/v1/metrics/kpis')
      .set({ 'x-api-key': envs.API_KEY });

    expect(res.status).toBe(401);
  });

  it('rejects a Vendedor', async () => {
    findUserMock.mockResolvedValue(userWithRole('Vendedor'));

    const res = await request(app).get('/api/v1/metrics/kpis').set(AUTH);

    expect(res.status).toBe(403);
    expect(getCompanyKpisMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/metrics/kpis', () => {
  it('returns the envelope with the thresholds in force', async () => {
    const res = await request(app)
      .get('/api/v1/metrics/kpis?from=2026-09-01&to=2026-09-30')
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.thresholds.inactivity_days).toBe(30);
    expect(getCompanyKpisMock).toHaveBeenCalledWith(expect.anything(), {
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });

  it('coerces the inactivity override to a number', async () => {
    await request(app).get('/api/v1/metrics/kpis?inactivity_days=60').set(AUTH);

    expect(getCompanyKpisMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ inactivity_days: 60 })
    );
  });

  it('parses a comma-separated KPI selection, trimming and deduplicating', async () => {
    const res = await request(app)
      .get('/api/v1/metrics/kpis?kpis=total_sales, average_ticket,total_sales')
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(getCompanyKpisMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kpis: ['total_sales', 'average_ticket'] })
    );
  });

  it('accepts the KPI param repeated', async () => {
    await request(app)
      .get('/api/v1/metrics/kpis?kpis=total_sales&kpis=orders_count')
      .set(AUTH);

    expect(getCompanyKpisMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kpis: ['total_sales', 'orders_count'] })
    );
  });

  it('rejects an unknown KPI name', async () => {
    const res = await request(app)
      .get('/api/v1/metrics/kpis?kpis=total_sales,monto_cobrado')
      .set(AUTH);

    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toMatch(/^kpis/);
    expect(getCompanyKpisMock).not.toHaveBeenCalled();
  });

  it('rejects an empty KPI selection', async () => {
    const res = await request(app).get('/api/v1/metrics/kpis?kpis=').set(AUTH);

    expect(res.status).toBe(400);
  });

  it('rejects `from` after `to`', async () => {
    const res = await request(app)
      .get('/api/v1/metrics/kpis?from=2026-10-01&to=2026-09-01')
      .set(AUTH);

    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe('from');
  });

  it('rejects a range longer than a year', async () => {
    const res = await request(app)
      .get('/api/v1/metrics/kpis?from=2025-01-01&to=2026-09-01')
      .set(AUTH);

    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe('to');
  });

  it('rejects a malformed date', async () => {
    const res = await request(app).get('/api/v1/metrics/kpis?from=01/09/2026').set(AUTH);

    expect(res.status).toBe(400);
  });

  it('rejects an out-of-range threshold', async () => {
    const res = await request(app).get('/api/v1/metrics/kpis?inactivity_days=0').set(AUTH);

    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/metrics/sellers/:id', () => {
  it('rejects an invalid id', async () => {
    const res = await request(app).get('/api/v1/metrics/sellers/not-a-uuid').set(AUTH);

    expect(res.status).toBe(400);
  });

  it('passes the seller id to the service', async () => {
    const res = await request(app).get(`/api/v1/metrics/sellers/${SELLER_ID}`).set(AUTH);

    expect(res.status).toBe(200);
    expect(getSellerDetailMock).toHaveBeenCalledWith(expect.anything(), SELLER_ID, {});
  });
});

describe('GET /api/v1/metrics/trends', () => {
  it('defaults the granularity to week', async () => {
    await request(app).get('/api/v1/metrics/trends').set(AUTH);

    expect(getTrendsMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ granularity: 'week' })
    );
  });

  it('rejects an unknown granularity', async () => {
    const res = await request(app).get('/api/v1/metrics/trends?granularity=day').set(AUTH);

    expect(res.status).toBe(400);
  });
});

describe.each(['/coverage', '/purchase-frequency', '/sellers'])('GET /api/v1/metrics%s', (path) => {
  it('responds 200 for an admin', async () => {
    const res = await request(app).get(`/api/v1/metrics${path}`).set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data.period).toEqual(context.period);
  });
});
