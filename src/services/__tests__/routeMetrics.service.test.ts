import { Prisma } from '../../generated/prisma/client';
import { Client } from '../../lib/prisma';
import { ROUTE_TOP_LIMIT } from '../../domain/schemas/routeMetrics.schema';
import { getRouteMetricsDetail, listRouteMetrics } from '../routeMetrics.service';

const NOW = new Date('2026-09-22T18:00:00Z');
const ROUTE_ID = '22222222-2222-2222-2222-222222222201';
const OTHER_ROUTE_ID = '22222222-2222-2222-2222-222222222202';
const SEPTEMBER = { from: '2026-09-01', to: '2026-09-30' };
/** The 30 days right before September: what previousRange() builds from it. */
const AUGUST_TAIL = { from: '2026-08-02', to: '2026-08-31' };

const buildClient = (queryRaw: jest.Mock) => ({ $queryRaw: queryRaw }) as unknown as Client;

/** The Prisma.Sql sent on a given $queryRaw call, to inspect text and values. */
const sqlOf = (mock: jest.Mock, call: number) => mock.mock.calls[call][0] as Prisma.Sql;

const isoInstants = (sql: Prisma.Sql) =>
  sql.values
    .filter((value): value is Date => value instanceof Date)
    .map((value) => value.toISOString());

/** A route card as the query returns it, before the service adds `change_rate`. */
const routeRow = (overrides: Record<string, unknown> = {}) => ({
  route_id: ROUTE_ID,
  name: 'Zona Escalón',
  municipality: 'San Salvador',
  zone: 'Escalón',
  active: true,
  amount: '9170.00',
  previous_amount: '8100.00',
  visit_coverage_rate: 90.0,
  sellers: [{ user_id: 'u1', name: 'Carlos Martínez' }],
  ...overrides,
});

/** The five queries the detail runs after the card, in call order. */
const detailTail = (
  queryRaw: jest.Mock,
  coverage: { scheduled_customers: number; purchasing_customers: number } = {
    scheduled_customers: 20,
    purchasing_customers: 14,
  }
) =>
  queryRaw
    .mockResolvedValueOnce([coverage])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([]);

describe('listRouteMetrics', () => {
  it('returns every route as a card, with the variation and the period total', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([
        routeRow(),
        routeRow({ route_id: OTHER_ROUTE_ID, name: 'Zona Centro', amount: '2830.00', previous_amount: '0.00' }),
      ])
      .mockResolvedValueOnce([{ amount: '12000.00', invoices: 90 }]);

    const result = await listRouteMetrics(buildClient(queryRaw), SEPTEMBER, NOW);

    expect(result.period).toEqual(SEPTEMBER);
    expect(result.previous_period).toEqual(AUGUST_TAIL);
    expect(result.total_amount).toBe('12000.00');
    expect(result.routes.map((route) => route.route_id)).toEqual([ROUTE_ID, OTHER_ROUTE_ID]);
    expect(result.routes[0].change_rate).toBe(13.2);
    // Growing from zero has no rate: null, never 100 % or Infinity.
    expect(result.routes[1].change_rate).toBeNull();
    expect(result.routes[0].sellers).toEqual([{ user_id: 'u1', name: 'Carlos Martínez' }]);
  });

  it('attributes sale to the route the visit’s stop came from', async () => {
    const queryRaw = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ amount: '0.00', invoices: 0 }]);

    await listRouteMetrics(buildClient(queryRaw), SEPTEMBER, NOW);

    for (const call of [0, 1]) {
      const sql = sqlOf(queryRaw, call).sql;
      // sale -> visit -> scheduled_visit -> route_user -> route (CLAUDE.md 5.4).
      expect(sql).toContain('v.id = s.visit_id');
      expect(sql).toContain('sv.id = v.scheduled_visit_id');
      expect(sql).toContain('ru.id = sv.route_user_id');
      expect(sql).not.toContain('ru.id = v.route_user_id');
      expect(sql).toContain('s.deleted_at IS NULL');
      expect(sql).toContain('s.erp_status =');
      // Half-open [start, end) on the raw column, never `::date` in a WHERE.
      expect(sql).not.toMatch(/erp_created_at::date/);
    }
  });

  it('reads the current and the previous period in one pass', async () => {
    const queryRaw = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ amount: '0.00', invoices: 0 }]);

    await listRouteMetrics(buildClient(queryRaw), SEPTEMBER, NOW);

    expect(isoInstants(sqlOf(queryRaw, 0))).toEqual(
      expect.arrayContaining([
        '2026-08-02T06:00:00.000Z',
        '2026-09-01T06:00:00.000Z',
        '2026-10-01T06:00:00.000Z',
      ])
    );
  });

  it('measures visit coverage over the route’s agenda of the period', async () => {
    const queryRaw = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ amount: '0.00', invoices: 0 }]);

    await listRouteMetrics(buildClient(queryRaw), SEPTEMBER, NOW);

    const sql = sqlOf(queryRaw, 0);
    expect(sql.sql).toContain('FROM   scheduled_visit sv');
    expect(sql.sql).toContain('v.scheduled_visit_id = ag.id');
    expect(sql.values).toEqual(expect.arrayContaining(['2026-09-01', '2026-09-30']));
  });

  it('answers with an empty list and a zero total when there are no routes', async () => {
    const queryRaw = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const result = await listRouteMetrics(buildClient(queryRaw), SEPTEMBER, NOW);

    expect(result.routes).toEqual([]);
    expect(result.total_amount).toBe('0.00');
  });

  it('keeps a route with no activity as zeros, with no coverage and no variation', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([
        routeRow({ amount: '0.00', previous_amount: '0.00', visit_coverage_rate: null, sellers: [] }),
      ])
      .mockResolvedValueOnce([{ amount: '0.00', invoices: 0 }]);

    const [route] = (await listRouteMetrics(buildClient(queryRaw), SEPTEMBER, NOW)).routes;

    expect(route.amount).toBe('0.00');
    expect(route.change_rate).toBeNull();
    expect(route.visit_coverage_rate).toBeNull();
    expect(route.sellers).toEqual([]);
  });
});

describe('getRouteMetricsDetail', () => {
  it('returns the card, coverage and lists of one route', async () => {
    const queryRaw = jest.fn().mockResolvedValueOnce([routeRow()]);
    detailTail(queryRaw);

    const result = await getRouteMetricsDetail(buildClient(queryRaw), ROUTE_ID, SEPTEMBER, NOW);

    expect(result.previous_period).toEqual(AUGUST_TAIL);
    expect(result.route.route_id).toBe(ROUTE_ID);
    expect(result.route.change_rate).toBe(13.2);
    expect(result.portfolio_coverage).toEqual({ scheduled_customers: 20, purchasing_customers: 14, rate: 70 });
    expect(result.top_customers).toEqual([]);
    expect(result.top_products).toEqual([]);
    expect(result.sales_by_weekday).toEqual([]);
    expect(result.seller_performance).toEqual([]);
  });

  it('filters the card query to the route', async () => {
    const queryRaw = jest.fn().mockResolvedValueOnce([routeRow()]);
    detailTail(queryRaw);

    await getRouteMetricsDetail(buildClient(queryRaw), ROUTE_ID, SEPTEMBER, NOW);

    expect(sqlOf(queryRaw, 0).values).toContain(ROUTE_ID);
  });

  it('asks the top lists for ROUTE_TOP_LIMIT rows of this route', async () => {
    const queryRaw = jest.fn().mockResolvedValueOnce([routeRow()]);
    detailTail(queryRaw);

    await getRouteMetricsDetail(buildClient(queryRaw), ROUTE_ID, SEPTEMBER, NOW);

    for (const call of [2, 3]) {
      expect(sqlOf(queryRaw, call).values).toEqual(expect.arrayContaining([ROUTE_ID, ROUTE_TOP_LIMIT]));
    }
  });

  it('reads portfolio coverage from the agenda, not from today’s route composition', async () => {
    const queryRaw = jest.fn().mockResolvedValueOnce([routeRow()]);
    detailTail(queryRaw);

    await getRouteMetricsDetail(buildClient(queryRaw), ROUTE_ID, SEPTEMBER, NOW);

    const sql = sqlOf(queryRaw, 1).sql;
    expect(sql).toContain('FROM   scheduled_visit sv');
    expect(sql).not.toContain('route_customer');
  });

  it('leaves portfolio coverage null when the route had no agenda', async () => {
    const queryRaw = jest.fn().mockResolvedValueOnce([routeRow()]);
    detailTail(queryRaw, { scheduled_customers: 0, purchasing_customers: 0 });

    const result = await getRouteMetricsDetail(buildClient(queryRaw), ROUTE_ID, SEPTEMBER, NOW);

    expect(result.portfolio_coverage.rate).toBeNull();
  });

  it('404s when the route does not exist or is deleted', async () => {
    const queryRaw = jest.fn().mockResolvedValueOnce([]);
    detailTail(queryRaw);

    await expect(
      getRouteMetricsDetail(buildClient(queryRaw), ROUTE_ID, SEPTEMBER, NOW)
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
