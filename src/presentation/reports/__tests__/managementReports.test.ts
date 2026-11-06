import request from 'supertest';
import { AppRoutes } from '../../routes';
import { Server } from '../../server';
import { envs } from '../../../config/envs';
import { CustomError } from '../../../domain/errors/CustomError';
import { findUserByAuthUserId } from '../../../services/auth.service';
import * as service from '../../../services/managementReport.service';

// Management reports (PCRM-159): routing, guard and query validation. Auth is
// stubbed and the service mocked; the SQL runs against Postgres in
// __tests__/integration/managementReports.integration.test.ts and rendering
// in services/__tests__/managementReport.builders.test.ts.
jest.mock('../../../lib/supabaseJwt', () => ({
  verifyAccessToken: jest.fn().mockResolvedValue({ sub: 'auth-admin' }),
  JwksUnavailableError: class extends Error {},
  warmUpJwks: jest.fn(),
}));

jest.mock('../../../services/auth.service', () => ({
  findUserByAuthUserId: jest.fn(),
}));

jest.mock('../../../services/managementReport.service', () => ({
  generateSalesReport: jest.fn(),
  generateSellersComparisonReport: jest.fn(),
  generateAbcReport: jest.fn(),
  generateRankingsReport: jest.fn(),
  generateGoalsReport: jest.fn(),
  generatePlannedVsDoneReport: jest.fn(),
  generateVisitEffectivenessReport: jest.fn(),
  generateNewCustomersReport: jest.fn(),
  generateRecoveredCustomersReport: jest.fn(),
  generateCustomersWithoutPurchaseReport: jest.fn(),
  generateCollectionsReport: jest.fn(),
  generateOverduePortfolioReport: jest.fn(),
}));

const findUserMock = findUserByAuthUserId as jest.Mock;
const mocks = service as unknown as Record<string, jest.Mock>;

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

const AUTH = { 'x-api-key': envs.API_KEY, Authorization: 'Bearer token-de-prueba' };
const SELLER_ID = '11111111-1111-1111-1111-111111111101';
const ROUTE_ID = '22222222-2222-2222-2222-222222222201';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const userWithRole = (role: string) => ({
  id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  auth_user_id: 'auth-admin',
  role,
  name: 'Andrés Admin',
  email: 'admin@pragma.test',
  active: true,
  password_set_at: new Date('2026-09-11T12:00:00.000Z'),
});

/** The request object every generator receives as its last argument. */
type GeneratorRequest = { query: Record<string, unknown>; generatedBy?: string };
const lastRequest = (mock: jest.Mock): GeneratorRequest =>
  mock.mock.calls[0][mock.mock.calls[0].length - 1] as GeneratorRequest;

beforeEach(() => {
  jest.clearAllMocks();
  findUserMock.mockResolvedValue(userWithRole('Administrador'));
  for (const mock of Object.values(mocks).filter((value) => jest.isMockFunction(value))) {
    mock.mockImplementation(async (...args: unknown[]) => {
      const { query } = args[args.length - 1] as GeneratorRequest;
      const format = query.format as string;
      return {
        buffer: Buffer.from(format === 'pdf' ? '%PDF-1.7 fake' : 'PK fake'),
        filename: `pragma-crm_test_2026-09-01_2026-09-30.${format}`,
        contentType: format === 'pdf' ? 'application/pdf' : XLSX,
      };
    });
  }
});

describe('management reports access control', () => {
  it('rejects a Vendedor with 403', async () => {
    findUserMock.mockResolvedValue(userWithRole('Vendedor'));

    const res = await request(app).get('/api/v1/reports/sales/seller').set(AUTH);

    expect(res.status).toBe(403);
    expect(mocks.generateSalesReport).not.toHaveBeenCalled();
  });

  it('rejects a request without a token', async () => {
    const res = await request(app)
      .get('/api/v1/reports/collections')
      .set({ 'x-api-key': envs.API_KEY });

    expect(res.status).toBe(401);
  });
});

describe('routing', () => {
  it.each([
    ['/sales/seller', 'generateSalesReport'],
    ['/sales/product', 'generateSalesReport'],
    ['/sales/sellers-comparison', 'generateSellersComparisonReport'],
    ['/abc/customer', 'generateAbcReport'],
    ['/abc/product', 'generateAbcReport'],
    ['/rankings', 'generateRankingsReport'],
    ['/goals', 'generateGoalsReport'],
    ['/visits/planned-vs-done', 'generatePlannedVsDoneReport'],
    ['/visits/effectiveness', 'generateVisitEffectivenessReport'],
    ['/customers/new', 'generateNewCustomersReport'],
    ['/customers/recovered', 'generateRecoveredCustomersReport'],
    ['/customers/no-purchase', 'generateCustomersWithoutPurchaseReport'],
    ['/collections', 'generateCollectionsReport'],
    ['/overdue-portfolio', 'generateOverduePortfolioReport'],
  ])('GET %s -> %s, as a file', async (path, generator) => {
    const res = await request(app).get(`/api/v1/reports${path}`).set(AUTH);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain(XLSX);
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="pragma-crm_test_2026-09-01_2026-09-30.xlsx"'
    );
    expect(mocks[generator]).toHaveBeenCalledTimes(1);
  });

  it('does not swallow the PCRM-162 seller report', async () => {
    const res = await request(app).get(`/api/v1/reports/sales/seller`).set(AUTH);

    expect(res.status).toBe(200);
    expect(mocks.generateSalesReport.mock.calls[0][1]).toBe('seller');
  });

  it('passes the entity of the ABC report', async () => {
    await request(app).get('/api/v1/reports/abc/product').set(AUTH);

    expect(mocks.generateAbcReport.mock.calls[0][1]).toBe('product');
  });
});

describe('query', () => {
  it('passes the filters, the format and the admin name', async () => {
    const res = await request(app)
      .get('/api/v1/reports/sales/route')
      .query({
        from: '2026-09-01',
        to: '2026-09-30',
        format: 'pdf',
        zone: ' Norte ',
        user_id: SELLER_ID,
        route_id: ROUTE_ID,
      })
      .set(AUTH);

    expect(res.status).toBe(200);
    const { query, generatedBy } = lastRequest(mocks.generateSalesReport);
    expect(query).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-30',
      format: 'pdf',
      zone: 'Norte',
      user_id: SELLER_ID,
      route_id: ROUTE_ID,
    });
    expect(generatedBy).toBe('Andrés Admin');
  });

  it('defaults the rankings limit to 50', async () => {
    await request(app).get('/api/v1/reports/rankings').set(AUTH);

    expect(lastRequest(mocks.generateRankingsReport).query.limit).toBe(50);
  });

  it.each([
    ['an unknown sales group', '/sales/department', {}],
    ['an unknown ABC entity', '/abc/seller', {}],
    ['an unknown format', '/collections', { format: 'csv' }],
    ['an inverted range', '/goals', { from: '2026-09-30', to: '2026-09-01' }],
    ['a seller id that is not a uuid', '/sales/seller', { user_id: 'ana' }],
    ['a route id that is not a uuid', '/sales/seller', { route_id: '12' }],
    ['an empty zone', '/sales/zone', { zone: '  ' }],
    ['a rankings limit over the max', '/rankings', { limit: '501' }],
  ])('rejects %s with 400', async (_, path, query) => {
    const res = await request(app).get(`/api/v1/reports${path}`).query(query).set(AUTH);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('answers the service 404 as JSON', async () => {
    mocks.generateCollectionsReport.mockRejectedValue(CustomError.notFound('Seller not found'));

    const res = await request(app)
      .get('/api/v1/reports/collections')
      .query({ user_id: SELLER_ID })
      .set(AUTH);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, message: 'Seller not found' });
  });
});
