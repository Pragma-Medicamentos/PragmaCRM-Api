import request from 'supertest';
import { AppRoutes } from '../../routes';
import { Server } from '../../server';
import { envs } from '../../../config/envs';
import { findUserByAuthUserId } from '../../../services/auth.service';
import {
  getKpi,
  getKpiValues,
  getCoverage,
  getPurchaseFrequency,
  getSellerDetail,
  getTrends,
  listKpiCatalog,
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
  listKpiCatalog: jest.fn(),
  getKpiValues: jest.fn(),
  getKpi: jest.fn(),
  listSellerPerformance: jest.fn(),
  getSellerDetail: jest.fn(),
  getTrends: jest.fn(),
  getCoverage: jest.fn(),
  getPurchaseFrequency: jest.fn(),
}));

const findUserMock = findUserByAuthUserId as jest.Mock;
const getKpiValuesMock = getKpiValues as jest.Mock;
const getKpiMock = getKpi as jest.Mock;
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
  (listKpiCatalog as jest.Mock).mockReturnValue({ kpis: [] });
  getKpiValuesMock.mockResolvedValue({ ...context, kpis: {} });
  getKpiMock.mockResolvedValue({ ...context, name: 'total_sales', value: '0.00' });
  (listSellerPerformance as jest.Mock).mockResolvedValue({ ...context, sellers: [] });
  getSellerDetailMock.mockResolvedValue({ ...context, seller: {} });
  getTrendsMock.mockResolvedValue({ ...context, granularity: 'week', points: [] });
  (getCoverage as jest.Mock).mockResolvedValue({ ...context, customers: [] });
  (getPurchaseFrequency as jest.Mock).mockResolvedValue({ ...context, buckets: [] });
});

describe('metrics access control', () => {
  it('rejects a request without a token', async () => {
    const res = await request(app)
      .get('/api/v1/metrics/kpis/values')
      .set({ 'x-api-key': envs.API_KEY });

    expect(res.status).toBe(401);
  });

  it('rejects a Vendedor', async () => {
    findUserMock.mockResolvedValue(userWithRole('Vendedor'));

    const res = await request(app).get('/api/v1/metrics/kpis/values').set(AUTH);

    expect(res.status).toBe(403);
    expect(getKpiValuesMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/metrics/kpis (catalog)', () => {
  it('returns the catalog without computing any KPI', async () => {
    const res = await request(app).get('/api/v1/metrics/kpis').set(AUTH);

    expect(res.status).toBe(200);
    expect(listKpiCatalog).toHaveBeenCalled();
    expect(getKpiValuesMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/metrics/kpis/values', () => {
  it('returns the envelope with the thresholds in force', async () => {
    const res = await request(app)
      .get('/api/v1/metrics/kpis/values?from=2026-09-01&to=2026-09-30')
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.thresholds.inactivity_days).toBe(30);
    expect(getKpiValuesMock).toHaveBeenCalledWith(expect.anything(), {
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });

  it('coerces the inactivity override to a number', async () => {
    await request(app).get('/api/v1/metrics/kpis/values?inactivity_days=60').set(AUTH);

    expect(getKpiValuesMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ inactivity_days: 60 })
    );
  });

  it('parses a comma-separated KPI selection, trimming and deduplicating', async () => {
    const res = await request(app)
      .get('/api/v1/metrics/kpis/values?names=total_sales, average_ticket,total_sales')
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(getKpiValuesMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ names: ['total_sales', 'average_ticket'] })
    );
  });

  it('accepts the names param repeated', async () => {
    await request(app)
      .get('/api/v1/metrics/kpis/values?names=total_sales&names=orders_count')
      .set(AUTH);

    expect(getKpiValuesMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ names: ['total_sales', 'orders_count'] })
    );
  });

  it('rejects an unknown KPI name', async () => {
    const res = await request(app)
      .get('/api/v1/metrics/kpis/values?names=total_sales,monto_cobrado')
      .set(AUTH);

    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toMatch(/^names/);
    expect(getKpiValuesMock).not.toHaveBeenCalled();
  });

  it('rejects an empty KPI selection', async () => {
    const res = await request(app).get('/api/v1/metrics/kpis/values?names=').set(AUTH);

    expect(res.status).toBe(400);
  });

  it('rejects `from` after `to`', async () => {
    const res = await request(app)
      .get('/api/v1/metrics/kpis/values?from=2026-10-01&to=2026-09-01')
      .set(AUTH);

    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe('from');
  });

  it('rejects a range longer than a year', async () => {
    const res = await request(app)
      .get('/api/v1/metrics/kpis/values?from=2025-01-01&to=2026-09-01')
      .set(AUTH);

    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe('to');
  });

  it('rejects a malformed date', async () => {
    const res = await request(app).get('/api/v1/metrics/kpis/values?from=01/09/2026').set(AUTH);

    expect(res.status).toBe(400);
  });

  it('rejects an out-of-range threshold', async () => {
    const res = await request(app).get('/api/v1/metrics/kpis/values?inactivity_days=0').set(AUTH);

    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/metrics/kpis/:name', () => {
  it('passes the name and the range to the service', async () => {
    const res = await request(app)
      .get('/api/v1/metrics/kpis/total_sales?from=2026-09-01&to=2026-09-30')
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(getKpiMock).toHaveBeenCalledWith(expect.anything(), 'total_sales', {
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });

  it('is not shadowed by the batch route', async () => {
    await request(app).get('/api/v1/metrics/kpis/values').set(AUTH);

    expect(getKpiMock).not.toHaveBeenCalled();
    expect(getKpiValuesMock).toHaveBeenCalled();
  });

  it('validates the range like the other endpoints', async () => {
    const res = await request(app)
      .get('/api/v1/metrics/kpis/total_sales?from=2026-10-01&to=2026-09-01')
      .set(AUTH);

    expect(res.status).toBe(400);
    expect(getKpiMock).not.toHaveBeenCalled();
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
