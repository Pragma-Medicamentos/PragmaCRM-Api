import request from 'supertest';
import { AppRoutes } from '../../routes';
import { Server } from '../../server';
import { envs } from '../../../config/envs';
import { CustomError } from '../../../domain/errors/CustomError';
import { findUserByAuthUserId } from '../../../services/auth.service';
import {
  generateCoverageReport,
  generateKpiReport,
  generateKpisReport,
  generateProductsReport,
  generatePurchaseFrequencyReport,
  generateSellerDetailReport,
  generateSellersReport,
  generateTrendsReport,
} from '../../../services/report.service';

// Reports are admin-only, like the metrics they come from (RF-09). Auth is
// stubbed and the report service mocked: rendering is covered by
// services/__tests__/report.service.test.ts.
jest.mock('../../../lib/supabaseJwt', () => ({
  verifyAccessToken: jest.fn().mockResolvedValue({ sub: 'auth-admin' }),
  JwksUnavailableError: class extends Error {},
  warmUpJwks: jest.fn(),
}));

jest.mock('../../../services/auth.service', () => ({
  findUserByAuthUserId: jest.fn(),
}));

jest.mock('../../../services/report.service', () => ({
  generateKpisReport: jest.fn(),
  generateKpiReport: jest.fn(),
  generateSellersReport: jest.fn(),
  generateSellerDetailReport: jest.fn(),
  generateTrendsReport: jest.fn(),
  generateCoverageReport: jest.fn(),
  generateProductsReport: jest.fn(),
  generatePurchaseFrequencyReport: jest.fn(),
}));

const findUserMock = findUserByAuthUserId as jest.Mock;

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

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const fakeReport = (format: string) => ({
  buffer: Buffer.from(format === 'pdf' ? '%PDF-1.7 fake' : 'PK fake'),
  filename: `pragma-crm_test_2026-09-01_2026-09-30.${format}`,
  contentType: format === 'pdf' ? 'application/pdf' : XLSX,
});

const generators = [
  generateKpisReport,
  generateKpiReport,
  generateSellersReport,
  generateSellerDetailReport,
  generateTrendsReport,
  generateCoverageReport,
  generateProductsReport,
  generatePurchaseFrequencyReport,
] as jest.Mock[];

beforeEach(() => {
  jest.clearAllMocks();
  findUserMock.mockResolvedValue(userWithRole('Administrador'));
  for (const generate of generators) {
    generate.mockImplementation(async (...args: unknown[]) => {
      const query = args.find(
        (arg) => typeof arg === 'object' && arg !== null && 'format' in arg
      ) as { format: string };
      return fakeReport(query.format);
    });
  }
});

describe('reports access control', () => {
  it('rejects a request without a token', async () => {
    const res = await request(app).get('/api/v1/reports/kpis').set({ 'x-api-key': envs.API_KEY });

    expect(res.status).toBe(401);
  });

  it('rejects a Vendedor', async () => {
    findUserMock.mockResolvedValue(userWithRole('Vendedor'));

    const res = await request(app).get('/api/v1/reports/kpis').set(AUTH);

    expect(res.status).toBe(403);
    expect(generateKpisReport).not.toHaveBeenCalled();
  });
});

describe('one report per metrics endpoint', () => {
  it.each([
    ['/kpis', generateKpisReport],
    ['/kpis/total_sales', generateKpiReport],
    ['/sellers', generateSellersReport],
    [`/sellers/${SELLER_ID}`, generateSellerDetailReport],
    ['/trends', generateTrendsReport],
    ['/coverage', generateCoverageReport],
    ['/products', generateProductsReport],
    ['/purchase-frequency', generatePurchaseFrequencyReport],
  ])('GET %s downloads an xlsx by default', async (path, generate) => {
    const res = await request(app).get(`/api/v1/reports${path}`).set(AUTH);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe(XLSX);
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="pragma-crm_test_2026-09-01_2026-09-30.xlsx"'
    );
    expect(res.headers['cache-control']).toBe('no-store');
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe('query handling', () => {
  it('passes the metrics filters and the format through', async () => {
    const res = await request(app)
      .get('/api/v1/reports/kpis?from=2026-09-01&to=2026-09-30&names=total_sales,orders_count&format=pdf')
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(generateKpisReport).toHaveBeenCalledWith(expect.anything(), {
      from: '2026-09-01',
      to: '2026-09-30',
      names: ['total_sales', 'orders_count'],
      format: 'pdf',
    });
  });

  it('applies the defaults of the mirrored metrics endpoint', async () => {
    await request(app).get('/api/v1/reports/trends').set(AUTH);
    await request(app).get('/api/v1/reports/products').set(AUTH);

    expect(generateTrendsReport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ granularity: 'week', format: 'xlsx' })
    );
    expect(generateProductsReport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 50 })
    );
  });

  it('rejects an unknown format', async () => {
    const res = await request(app).get('/api/v1/reports/coverage?format=csv').set(AUTH);

    expect(res.status).toBe(400);
    expect(generateCoverageReport).not.toHaveBeenCalled();
  });

  it('rejects an inverted range', async () => {
    const res = await request(app)
      .get('/api/v1/reports/sellers?from=2026-09-30&to=2026-09-01')
      .set(AUTH);

    expect(res.status).toBe(400);
  });

  it('rejects a seller id that is not a uuid', async () => {
    const res = await request(app).get('/api/v1/reports/sellers/not-a-uuid').set(AUTH);

    expect(res.status).toBe(400);
    expect(generateSellerDetailReport).not.toHaveBeenCalled();
  });
});

describe('errors stay JSON', () => {
  it('answers 404 with the envelope for an unknown seller', async () => {
    (generateSellerDetailReport as jest.Mock).mockRejectedValue(
      CustomError.notFound('Seller not found')
    );

    const res = await request(app).get(`/api/v1/reports/sellers/${SELLER_ID}`).set(AUTH);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(expect.objectContaining({ success: false, message: 'Seller not found' }));
  });
});
