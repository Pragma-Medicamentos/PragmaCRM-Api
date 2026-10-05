import { Prisma } from '../../generated/prisma/client';
import { Client } from '../../lib/prisma';
import { envs } from '../../config/envs';
import { ROUTE_TOP_LIMIT } from '../../domain/schemas/routeMetrics.schema';
import {
  getRouteAverageTicket,
  getRouteMetricsDetail,
  listRouteMetrics,
} from '../routeMetrics.service';

const NOW = new Date('2026-09-22T18:00:00Z');
const ROUTE_ID = '22222222-2222-2222-2222-222222222201';
const OTHER_ROUTE_ID = '22222222-2222-2222-2222-222222222202';
const SEPTEMBER = { from: '2026-09-01', to: '2026-09-30' };

const buildClient = (queryRaw: jest.Mock) => ({ $queryRaw: queryRaw }) as unknown as Client;

/** The Prisma.Sql sent on a given $queryRaw call, to inspect text and values. */
const sqlOf = (mock: jest.Mock, call: number) => mock.mock.calls[call][0] as Prisma.Sql;

const isoInstants = (sql: Prisma.Sql) =>
  sql.values
    .filter((value): value is Date => value instanceof Date)
    .map((value) => value.toISOString());

/** A row as the ranking query returns it: metrics plus the period totals. */
const routeRow = (overrides: Record<string, unknown> = {}) => ({
  route_id: ROUTE_ID,
  name: 'Zona Escalón',
  municipality: 'San Salvador',
  zone: 'Escalón',
  active: true,
  amount: '9170.00',
  units: '1240.0000',
  amount_position: 1,
  units_position: 1,
  executed_route_days: 7,
  effectiveness: '1310.00',
  visited_customers: 18,
  planned_customers: 20,
  visit_coverage_rate: 90.0,
  stops_executed: 72,
  stops_planned: 80,
  sellers: [{ user_id: 'u1', name: 'Carlos Martínez' }],
  total_amount: '12000.00',
  total_units: '1500.0000',
  ...overrides,
});

/** The six queries the detail runs after the ranking row, in call order. */
const detailTail = (
  queryRaw: jest.Mock,
  overrides: {
    previous?: { amount: string; units: string; invoices: number };
    coverage?: { assigned_customers: number; purchasing_customers: number };
  } = {}
) =>
  queryRaw
    .mockResolvedValueOnce([
      overrides.previous ?? { amount: '8100.00', units: '1100.0000', invoices: 62 },
    ])
    .mockResolvedValueOnce([
      overrides.coverage ?? { assigned_customers: 20, purchasing_customers: 14 },
    ])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([]);

describe('listRouteMetrics', () => {
  it('returns every route ranked, with the period totals lifted out of the rows', async () => {
    const queryRaw = jest.fn().mockResolvedValue([
      routeRow(),
      routeRow({
        route_id: OTHER_ROUTE_ID,
        name: 'Zona Centro',
        amount: '2830.00',
        units: '260.0000',
        amount_position: 2,
        units_position: 2,
      }),
    ]);

    const result = await listRouteMetrics(buildClient(queryRaw), SEPTEMBER, NOW);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(result.period).toEqual(SEPTEMBER);
    expect(result.total_amount).toBe('12000.00');
    expect(result.total_units).toBe('1500.0000');
    expect(result.routes.map((route) => route.route_id)).toEqual([ROUTE_ID, OTHER_ROUTE_ID]);
    expect(result.routes[0].sellers).toEqual([{ user_id: 'u1', name: 'Carlos Martínez' }]);
    // The totals ride on every row; they belong to the response, not to a route.
    expect(result.routes[0]).not.toHaveProperty('total_amount');
    expect(result.routes[0]).not.toHaveProperty('total_units');
  });

  it('attributes sale through the visit, like the company-wide KPI', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);

    await listRouteMetrics(buildClient(queryRaw), SEPTEMBER, NOW);

    const sql = sqlOf(queryRaw, 0).sql;
    // sale -> visit -> route_user -> route (CLAUDE.md 5.4): no route column on sale.
    expect(sql).toContain('v.id = s.visit_id');
    expect(sql).toContain('v.route_user_id IS NOT NULL');
    expect(sql).toContain('ru.id = v.route_user_id');
    expect(sql).not.toMatch(/\bs\.route_id\b/);
    expect(sql).toContain('s.deleted_at IS NULL');
    expect(sql).toContain('s.erp_status =');
    // Units in the product's base unit, like the product ranking.
    expect(sql).toContain('SUM(d.quantity * COALESCE(d.factor, 1))');
    // Half-open [start, end) on the raw columns, never `::date` in a WHERE.
    expect(sql).not.toMatch(/erp_created_at::date/);
    expect(sql).not.toMatch(/started_at::date\s*>=/);
    expect(isoInstants(sqlOf(queryRaw, 0))).toEqual(
      expect.arrayContaining(['2026-09-01T06:00:00.000Z', '2026-10-01T06:00:00.000Z'])
    );
  });

  it('answers with an empty list and zero totals when there are no routes', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);

    const result = await listRouteMetrics(buildClient(queryRaw), SEPTEMBER, NOW);

    expect(result.routes).toEqual([]);
    expect(result.total_amount).toBe('0.00');
    expect(result.total_units).toBe('0.0000');
  });

  it('keeps a route with no activity as zeros, with no effectiveness', async () => {
    const queryRaw = jest.fn().mockResolvedValue([
      routeRow({
        amount: '0.00',
        units: '0.0000',
        executed_route_days: 0,
        // The query divides with NULLIF: no route-day is a null, not a crash.
        effectiveness: null,
        visited_customers: 0,
        planned_customers: 0,
        visit_coverage_rate: null,
        stops_executed: 0,
        stops_planned: 0,
        sellers: [],
        total_amount: '0.00',
        total_units: '0.0000',
      }),
    ]);

    const result = await listRouteMetrics(buildClient(queryRaw), SEPTEMBER, NOW);

    expect(result.routes[0]).toMatchObject({
      amount: '0.00',
      executed_route_days: 0,
      effectiveness: null,
      visit_coverage_rate: null,
      stops_executed: 0,
      sellers: [],
    });
    expect(result.total_amount).toBe('0.00');
  });

  it('guards effectiveness and coverage against a division by zero in SQL', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);

    await listRouteMetrics(buildClient(queryRaw), SEPTEMBER, NOW);

    const sql = sqlOf(queryRaw, 0).sql;
    expect(sql).toContain('NULLIF(rd.days, 0)');
    expect(sql).toContain('NULLIF(p.planned_customers, 0)');
  });

  it('echoes the thresholds in force', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);

    const result = await listRouteMetrics(buildClient(queryRaw), {}, NOW);

    expect(result.thresholds).toEqual({
      inactivity_days: envs.INACTIVITY_THRESHOLD_DAYS,
      credit_term_days: 60,
      gps_radius_meters: 80,
    });
    // Omitted bounds default to the current month in El Salvador.
    expect(result.period).toEqual(SEPTEMBER);
  });
});

describe('getRouteMetricsDetail', () => {
  it('assembles the route with its trend, coverage and top lists', async () => {
    const topCustomers = [
      {
        position: 1,
        customer_id: 'c1',
        name: 'Farmacia San José',
        trade_name: null,
        amount: '2100.00',
        orders_count: 9,
      },
    ];
    const topProducts = [
      {
        position: 1,
        product_id: 42,
        code: 'ABC-1',
        name: 'Producto X',
        amount: '1500.00',
        units: '120.0000',
      },
    ];
    const weekdays = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      amount: weekday === 1 ? '9170.00' : '0.00',
      orders_count: weekday === 1 ? 72 : 0,
    }));
    const sellers = [
      { user_id: 'u1', name: 'Carlos Martínez', amount: '9170.00', units: '1240.0000', orders_count: 72 },
    ];

    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([routeRow()])
      .mockResolvedValueOnce([{ amount: '8100.00', units: '1100.0000', invoices: 62 }])
      .mockResolvedValueOnce([{ assigned_customers: 20, purchasing_customers: 14 }])
      .mockResolvedValueOnce(topCustomers)
      .mockResolvedValueOnce(topProducts)
      .mockResolvedValueOnce(weekdays)
      .mockResolvedValueOnce(sellers);

    const result = await getRouteMetricsDetail(
      buildClient(queryRaw),
      ROUTE_ID,
      SEPTEMBER,
      NOW
    );

    expect(result.route.route_id).toBe(ROUTE_ID);
    expect(result.route.effectiveness).toBe('1310.00');
    expect(result.previous).toEqual({
      period: { from: '2026-08-02', to: '2026-08-31' },
      amount: '8100.00',
      // (9170 - 8100) / 8100 = 13.2 %
      change_rate: 13.2,
    });
    expect(result.portfolio_coverage).toEqual({
      assigned_customers: 20,
      purchasing_customers: 14,
      rate: 70,
    });
    expect(result.top_customers).toEqual(topCustomers);
    expect(result.top_products).toEqual(topProducts);
    expect(result.sales_by_weekday).toHaveLength(7);
    expect(result.seller_performance).toEqual(sellers);
    // PCRM-176, not this issue: no average ticket anywhere in the payload.
    expect(result.route).not.toHaveProperty('average_ticket');
    expect(JSON.stringify(result)).not.toContain('average_ticket');
  });

  it('asks the previous period of equal length for the trend', async () => {
    const queryRaw = detailTail(jest.fn().mockResolvedValueOnce([routeRow()]));

    await getRouteMetricsDetail(buildClient(queryRaw), ROUTE_ID, SEPTEMBER, NOW);

    expect(queryRaw).toHaveBeenCalledTimes(7);
    // Second call is the previous-period total: 2 Aug .. 31 Aug, 30 local days.
    expect(isoInstants(sqlOf(queryRaw, 1))).toEqual([
      '2026-08-02T06:00:00.000Z',
      '2026-09-01T06:00:00.000Z',
    ]);
    expect(sqlOf(queryRaw, 1).values).toContain(ROUTE_ID);
    // The ranking row is filtered after the window functions, so the detail
    // reports the position the route holds among all of them.
    expect(sqlOf(queryRaw, 0).sql).toContain('ranked.route_id =');
  });

  it('returns no change rate when the previous period sold nothing', async () => {
    const queryRaw = detailTail(jest.fn().mockResolvedValueOnce([routeRow()]), {
      previous: { amount: '0.00', units: '0.0000', invoices: 0 },
    });

    const result = await getRouteMetricsDetail(
      buildClient(queryRaw),
      ROUTE_ID,
      SEPTEMBER,
      NOW
    );

    expect(result.previous.amount).toBe('0.00');
    // Growth from zero has no rate: null, never a division by zero.
    expect(result.previous.change_rate).toBeNull();
  });

  it('reports a drop as a negative change rate', async () => {
    const queryRaw = detailTail(
      jest.fn().mockResolvedValueOnce([routeRow({ amount: '4050.00' })]),
      { previous: { amount: '8100.00', units: '1100.0000', invoices: 62 } }
    );

    const result = await getRouteMetricsDetail(
      buildClient(queryRaw),
      ROUTE_ID,
      SEPTEMBER,
      NOW
    );

    expect(result.previous.change_rate).toBe(-50);
  });

  it('has no portfolio coverage when the route has no customers assigned', async () => {
    const queryRaw = detailTail(jest.fn().mockResolvedValueOnce([routeRow()]), {
      coverage: { assigned_customers: 0, purchasing_customers: 0 },
    });

    const result = await getRouteMetricsDetail(
      buildClient(queryRaw),
      ROUTE_ID,
      SEPTEMBER,
      NOW
    );

    expect(result.portfolio_coverage).toEqual({
      assigned_customers: 0,
      purchasing_customers: 0,
      rate: null,
    });
  });

  it('carries a route that sold nothing through the whole detail', async () => {
    const queryRaw = detailTail(
      jest.fn().mockResolvedValueOnce([
        routeRow({
          amount: '0.00',
          units: '0.0000',
          executed_route_days: 0,
          effectiveness: null,
          visited_customers: 0,
          planned_customers: 12,
          visit_coverage_rate: 0,
          stops_executed: 0,
          stops_planned: 12,
        }),
      ]),
      { previous: { amount: '0.00', units: '0.0000', invoices: 0 } }
    );

    const result = await getRouteMetricsDetail(
      buildClient(queryRaw),
      ROUTE_ID,
      SEPTEMBER,
      NOW
    );

    // Agenda with no stop executed: 0 % coverage is a real figure, not a null.
    expect(result.route.visit_coverage_rate).toBe(0);
    expect(result.route.effectiveness).toBeNull();
    expect(result.previous.change_rate).toBeNull();
    expect(result.top_customers).toEqual([]);
    expect(result.seller_performance).toEqual([]);
  });

  it('keeps a fully covered route at 100 %', async () => {
    const queryRaw = detailTail(
      jest.fn().mockResolvedValueOnce([
        routeRow({ visited_customers: 20, planned_customers: 20, visit_coverage_rate: 100 }),
      ])
    );

    const result = await getRouteMetricsDetail(
      buildClient(queryRaw),
      ROUTE_ID,
      SEPTEMBER,
      NOW
    );

    expect(result.route.visit_coverage_rate).toBe(100);
  });

  it('limits both top lists to ROUTE_TOP_LIMIT rows', async () => {
    const queryRaw = detailTail(jest.fn().mockResolvedValueOnce([routeRow()]));

    await getRouteMetricsDetail(buildClient(queryRaw), ROUTE_ID, SEPTEMBER, NOW);

    expect(sqlOf(queryRaw, 3).values).toContain(ROUTE_TOP_LIMIT);
    expect(sqlOf(queryRaw, 4).values).toContain(ROUTE_TOP_LIMIT);
  });

  it('throws 404 when the route does not exist', async () => {
    const queryRaw = detailTail(jest.fn().mockResolvedValueOnce([]));

    await expect(
      getRouteMetricsDetail(buildClient(queryRaw), ROUTE_ID, SEPTEMBER, NOW)
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('getRouteAverageTicket', () => {
  /*
   * PCRM-176. Unlike the rest of the module this one also reads `route` with
   * the typed API, for the existence check, so the fake client carries
   * findFirst besides $queryRaw.
   */
  const buildTicketClient = (queryRaw: jest.Mock, findFirst: jest.Mock) =>
    ({ $queryRaw: queryRaw, route: { findFirst } }) as unknown as Client;

  const foundRoute = () => jest.fn().mockResolvedValue({ id: ROUTE_ID, name: 'Zona Escalón' });

  it('divides the attributed sale by the invoices behind it', async () => {
    const queryRaw = jest.fn().mockResolvedValue([
      { amount: '9170.00', units: '1240.0000', invoices: 62 },
    ]);

    const result = await getRouteAverageTicket(
      buildTicketClient(queryRaw, foundRoute()),
      ROUTE_ID,
      SEPTEMBER,
      NOW
    );

    expect(result).toEqual({
      route_id: ROUTE_ID,
      period: SEPTEMBER,
      amount: '9170.00',
      invoices: 62,
      // 9170 / 62 = 147.9032…, two decimals like the rest of the panel.
      average_ticket: '147.90',
    });
  });

  it('asks the same attribution the ranking uses, for this route and period', async () => {
    const queryRaw = jest.fn().mockResolvedValue([
      { amount: '9170.00', units: '1240.0000', invoices: 62 },
    ]);

    await getRouteAverageTicket(
      buildTicketClient(queryRaw, foundRoute()),
      ROUTE_ID,
      SEPTEMBER,
      NOW
    );

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const sql = sqlOf(queryRaw, 0);
    // sale -> visit -> route_user (CLAUDE.md 5.4): the shared CTE, not a new one.
    expect(sql.sql).toContain('v.id = s.visit_id');
    expect(sql.sql).toContain('COUNT(DISTINCT a.erp_sale_id)');
    expect(sql.values).toContain(ROUTE_ID);
    expect(isoInstants(sql)).toEqual([
      '2026-09-01T06:00:00.000Z',
      '2026-10-01T06:00:00.000Z',
    ]);
  });

  it('has no ticket when the route sold nothing, instead of dividing by zero', async () => {
    const queryRaw = jest.fn().mockResolvedValue([
      { amount: '0.00', units: '0.0000', invoices: 0 },
    ]);

    const result = await getRouteAverageTicket(
      buildTicketClient(queryRaw, foundRoute()),
      ROUTE_ID,
      SEPTEMBER,
      NOW
    );

    expect(result.amount).toBe('0.00');
    expect(result.invoices).toBe(0);
    // No sale is not an average of zero: the figure does not exist.
    expect(result.average_ticket).toBeNull();
  });

  it('throws 404 when the route does not exist', async () => {
    const queryRaw = jest.fn();
    const findFirst = jest.fn().mockResolvedValue(null);

    await expect(
      getRouteAverageTicket(buildTicketClient(queryRaw, findFirst), ROUTE_ID, SEPTEMBER, NOW)
    ).rejects.toMatchObject({ statusCode: 404 });
    // An id that does not exist never reaches the sale query.
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
