import request from 'supertest';
import { DateTime } from 'luxon';
import { verifyAccessToken } from '../../lib/supabaseJwt';
import { prisma } from '../../lib/prisma';
import { AppRoutes } from '../../presentation/routes';
import { Server } from '../../presentation/server';
import { envs } from '../../config/envs';
import { ROLES } from '../../domain/types/auth.types';
import { ERP_TIMEZONE } from '../../lib/parseErpDate';
import { resolveRange } from '../../lib/localDateRange';
import { getKpiValues } from '../../services/metrics.service';
import {
  findCollectionsBySeller,
  findCustomersWithoutPurchase,
  findGoalsBySeller,
  findNewCustomers,
  findOverduePortfolio,
  findPlannedVsDone,
  findRecoveredCustomers,
  findSalesByGroup,
  findSellersComparison,
  findVisitEffectiveness,
} from '../../repositories/managementReports.repository';
import { SALES_REPORT_GROUPS } from '../../domain/schemas/report.schema';
import { ReportFilters } from '../../repositories/reports/filters.sql';

/**
 * PCRM-159 against real Postgres, over the data of supabase/seed.sql (last 18
 * months). The point is not exact figures but the invariants the ticket asks
 * for: with no filters, the management reports add up to the KPIs of the
 * panel for the same range, and every query runs with every filter.
 * Token verification is mocked.
 */

jest.mock('../../lib/supabaseJwt', () => ({
  verifyAccessToken: jest.fn(),
  JwksUnavailableError: class extends Error {},
  warmUpJwks: jest.fn(),
}));

const verifyAccessTokenMock = verifyAccessToken as unknown as jest.Mock;

const ADMIN_AUTH_ID = 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e159';
const HEADERS = { 'x-api-key': envs.API_KEY, Authorization: 'Bearer test' };
const NOW = new Date();

// Last full month: always inside the seed's 18 months.
const lastMonth = DateTime.fromJSDate(NOW, { zone: ERP_TIMEZONE }).minus({ months: 1 });
const RANGE = {
  from: lastMonth.startOf('month').toISODate() as string,
  to: lastMonth.endOf('month').toISODate() as string,
};
const range = resolveRange(RANGE.from, RANGE.to, NOW);

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

let adminId: string;
let filters: ReportFilters;

// supertest leaves unknown content types unparsed; collect the raw bytes.
const binary = (res: request.Response, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Uint8Array[] = [];
  res.on('data', (chunk: Uint8Array) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

const sumMoney = (rows: Record<string, unknown>[], key: string) =>
  Math.round(rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0) * 100) / 100;

const kpi = async (name: string) => {
  const data = await getKpiValues(prisma, { ...RANGE, names: [name] } as never, NOW);
  return (data.kpis as Record<string, { value: unknown }>)[name].value;
};

beforeAll(async () => {
  await prisma.$executeRaw`
    insert into auth.users (id, instance_id, aud, role, email)
    values (
      ${ADMIN_AUTH_ID}::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'authenticated', 'authenticated', 'management-reports-admin@pragma.test'
    )
    on conflict (id) do nothing`;
  adminId = (
    await prisma.app_user.create({
      data: {
        auth_user_id: ADMIN_AUTH_ID,
        role: ROLES.ADMIN,
        name: 'Reports Admin',
        email: 'management-reports-admin@pragma.test',
        active: true,
      },
    })
  ).id;

  // A real seller / route / zone of the seed, to exercise every filter.
  const assignment = await prisma.route_user.findFirst({
    where: { deleted_at: null },
    select: { user_id: true, route_id: true, route: { select: { zone: true } } },
  });
  filters = {
    userId: assignment?.user_id,
    routeId: assignment?.route_id,
    zone: assignment?.route.zone ?? undefined,
  };
});

beforeEach(() => {
  verifyAccessTokenMock.mockResolvedValue({ sub: ADMIN_AUTH_ID });
});

afterAll(async () => {
  await prisma.$executeRaw`delete from app_user where id = ${adminId}::uuid`;
  await prisma.$executeRaw`delete from auth.users where id = ${ADMIN_AUTH_ID}::uuid`;
  await prisma.$disconnect();
});

describe('management reports add up to the panel (no filters)', () => {
  it.each(SALES_REPORT_GROUPS.filter((group) => group !== 'product'))(
    'sales by %s adds up to total_sales',
    async (group) => {
      const rows = await findSalesByGroup(prisma, range, {}, group);
      expect(sumMoney(rows as never, 'amount')).toBe(Number(await kpi('total_sales')));
    }
  );

  it('the sellers comparison current period adds up to total_sales', async () => {
    const previousStart = resolveRange(
      lastMonth.minus({ months: 1 }).startOf('month').toISODate() as string,
      undefined,
      NOW
    ).start;
    const rows = await findSellersComparison(
      prisma,
      { start: previousStart, end: range.end },
      range.start,
      {}
    );
    expect(sumMoney(rows as never, 'cur_amount')).toBe(Number(await kpi('total_sales')));
  });

  it('the overdue portfolio adds up to overdue_portfolio', async () => {
    const rows = await findOverduePortfolio(prisma, NOW, {});
    expect(sumMoney(rows as never, 'pending_balance')).toBe(
      Number(await kpi('overdue_portfolio'))
    );
  });

  it('collections balances add up to pending_collections and overdue_portfolio', async () => {
    const rows = await findCollectionsBySeller(prisma, range, NOW, {});
    expect(sumMoney(rows as never, 'pending')).toBe(Number(await kpi('pending_collections')));
    expect(sumMoney(rows as never, 'overdue')).toBe(Number(await kpi('overdue_portfolio')));
  });

  it('goals: team sales over team goal is goal_compliance', async () => {
    const rows = await findGoalsBySeller(prisma, range);
    const goal = sumMoney(rows as never, 'goal_amount');
    const sales = sumMoney(rows as never, 'goal_sales');
    const expected = await kpi('goal_compliance');
    if (expected === null) {
      expect(goal).toBe(0);
    } else {
      expect(Math.round((1000 * sales) / goal) / 10).toBe(expected);
    }
  });

  it('recovered customers count matches recovered_customers', async () => {
    const data = await getKpiValues(prisma, { ...RANGE, names: ['recovered_customers'] } as never, NOW);
    const threshold = data.thresholds.inactivity_days;
    const rows = await findRecoveredCustomers(prisma, range, {}, threshold);
    expect(rows.length).toBe(Number(await kpi('recovered_customers')));
  });
});

describe('every management query runs with every filter', () => {
  const variants = (): [string, ReportFilters][] => [
    ['no filters', {}],
    ['seller', { userId: filters.userId }],
    ['route', { routeId: filters.routeId }],
    ['zone', { zone: filters.zone }],
    ['all three', filters],
  ];

  it('runs every query', async () => {
    for (const [, f] of variants()) {
      await Promise.all([
        ...SALES_REPORT_GROUPS.map((group) => findSalesByGroup(prisma, range, f, group)),
        findSellersComparison(prisma, range, range.start, f),
        findNewCustomers(prisma, range, f),
        findRecoveredCustomers(prisma, range, f, 30),
        findCustomersWithoutPurchase(prisma, range.end, f),
        findPlannedVsDone(prisma, range, f),
        findVisitEffectiveness(prisma, range, f),
        findCollectionsBySeller(prisma, range, NOW, f),
        findOverduePortfolio(prisma, NOW, f),
        findGoalsBySeller(prisma, range, f.userId),
      ]);
    }
  });

  it('a seller filter keeps only that seller', async () => {
    const all = await findSalesByGroup(prisma, range, {}, 'seller');
    const one = await findSalesByGroup(prisma, range, { userId: filters.userId }, 'seller');
    expect(one.every((row) => row.key === filters.userId)).toBe(true);
    expect(one.length).toBeLessThanOrEqual(1);
    expect(all.length).toBeGreaterThanOrEqual(one.length);
  });

  it('a route filter keeps only that route', async () => {
    const rows = await findSalesByGroup(prisma, range, { routeId: filters.routeId }, 'route');
    expect(rows.every((row) => row.key === filters.routeId)).toBe(true);
  });
});

describe('GET /api/v1/reports (management) end to end', () => {
  const PATHS = [
    '/sales/seller',
    '/sales/customer',
    '/sales/municipality',
    '/sales/route',
    '/sales/zone',
    '/sales/product',
    '/sales/sellers-comparison',
    '/abc/customer',
    '/abc/product',
    '/rankings',
    '/goals',
    '/visits/planned-vs-done',
    '/visits/effectiveness',
    '/customers/new',
    '/customers/recovered',
    '/customers/no-purchase',
    '/collections',
    '/overdue-portfolio',
  ];

  it.each(PATHS)('%s renders an xlsx', async (path) => {
    const res = await request(app)
      .get(`/api/v1/reports${path}`)
      .query(RANGE)
      .set(HEADERS)
      .buffer(true)
      .parse(binary);

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="pragma-crm_/);
    expect((res.body as Buffer).subarray(0, 2).toString()).toBe('PK');
  });

  it('renders a pdf with every filter', async () => {
    const res = await request(app)
      .get('/api/v1/reports/sales/seller')
      .query({
        ...RANGE,
        format: 'pdf',
        user_id: filters.userId,
        route_id: filters.routeId,
        ...(filters.zone ? { zone: filters.zone } : {}),
      })
      .set(HEADERS)
      .buffer(true)
      .parse(binary);

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain(
      `pragma-crm_ventas-por-vendedor_${RANGE.from}_${RANGE.to}.pdf`
    );
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('404 for a seller that does not exist', async () => {
    const res = await request(app)
      .get('/api/v1/reports/sales/seller')
      .query({ ...RANGE, user_id: '00000000-0000-4000-8000-000000000000' })
      .set(HEADERS);
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Seller not found');
  });
});
