import { Prisma } from '../../generated/prisma/client';
import { Client } from '../../lib/prisma';
import { envs } from '../../config/envs';
import { KPI_NAMES } from '../../domain/schemas/metrics.schema';
import {
  getCoverage,
  getKpi,
  getKpiValues,
  getProductRanking,
  getPurchaseFrequency,
  getSellerDetail,
  listKpiCatalog,
} from '../metrics.service';

const NOW = new Date('2026-09-22T18:00:00Z');
const SELLER_ID = '11111111-1111-1111-1111-111111111101';
const SEPTEMBER = { from: '2026-09-01', to: '2026-09-30' };

const sellerRow = {
  user_id: SELLER_ID,
  name: 'Rosa Alvarado',
  active: true,
  stops_executed: 66,
  stops_visit: 40,
  stops_dispatch: 20,
  stops_collection: 6,
  visited_customers: 30,
  orders_count: 66,
  total_sales: '6864.00',
  average_ticket: '104.00',
  goal_amount: '7500.00',
  goal_compliance: 91.5,
  route_sales: '5200.00',
  executed_route_days: 5,
  sales_per_route: '1040.00',
  dispatches_for_others: 2,
  portfolio_customers: 18,
};

const buildClient = (queryRaw: jest.Mock) => ({ $queryRaw: queryRaw }) as unknown as Client;

/** The Prisma.Sql sent on a given $queryRaw call, to inspect text and values. */
const sqlOf = (mock: jest.Mock, call: number) => mock.mock.calls[call][0] as Prisma.Sql;

const isoInstants = (sql: Prisma.Sql) =>
  sql.values
    .filter((value): value is Date => value instanceof Date)
    .map((value) => value.toISOString());

describe('listKpiCatalog', () => {
  it('describes every KPI without querying anything', () => {
    const { kpis } = listKpiCatalog();

    expect(kpis.map((kpi) => kpi.name)).toEqual([...KPI_NAMES]);
    expect(kpis.find((kpi) => kpi.name === 'total_sales')).toEqual({
      name: 'total_sales',
      unit: 'money',
      has_previous_period: true,
      thresholds: [],
    });
    expect(kpis.find((kpi) => kpi.name === 'overdue_portfolio')?.has_previous_period).toBe(false);
    expect(kpis.find((kpi) => kpi.name === 'customers_without_visit')?.thresholds).toEqual([
      'inactivity_days',
    ]);
  });
});

describe('getKpiValues', () => {
  it('runs one query per requested KPI and nothing else', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([{ value: '29264.00', previous_value: '27010.50' }])
      .mockResolvedValueOnce([{ value: 248, previous_value: 231 }]);

    const result = await getKpiValues(
      buildClient(queryRaw),
      { ...SEPTEMBER, names: ['total_sales', 'stops_executed'] },
      NOW
    );

    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(Object.keys(result.kpis)).toEqual(['total_sales', 'stops_executed']);
    expect(result.kpis.total_sales).toEqual({ value: '29264.00', previous_value: '27010.50' });
    expect(result.kpis.stops_executed).toEqual({ value: 248, previous_value: 231 });
    expect(result.period).toEqual(SEPTEMBER);
    expect(result.previous_period).toEqual({ from: '2026-08-02', to: '2026-08-31' });
  });

  it('computes all 17 KPIs when no name is given', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ value: 1, previous_value: 0 }]);

    const { kpis } = await getKpiValues(buildClient(queryRaw), {}, NOW);

    expect(queryRaw).toHaveBeenCalledTimes(KPI_NAMES.length);
    expect(Object.keys(kpis)).toEqual([...KPI_NAMES]);
  });

  it('maps the stops_by_type row into both periods', async () => {
    const queryRaw = jest.fn().mockResolvedValue([
      {
        visit: 41, dispatch: 12, collection: 9,
        previous_visit: 30, previous_dispatch: 10, previous_collection: 5,
      },
    ]);

    const { kpis } = await getKpiValues(buildClient(queryRaw), { names: ['stops_by_type'] }, NOW);

    expect(kpis.stops_by_type).toEqual({
      value: { visit: 41, dispatch: 12, collection: 9 },
      previous_value: { visit: 30, dispatch: 10, collection: 5 },
    });
  });

  it('isolates a failing KPI: it comes back as an error, the rest arrive', async () => {
    const queryRaw = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([{ value: 7, previous_value: 7 }]);

    const { kpis } = await getKpiValues(
      buildClient(queryRaw),
      { names: ['recovered_customers', 'new_prospects'] },
      NOW
    );

    expect(kpis.recovered_customers).toEqual({ error: 'KPI could not be computed' });
    expect(kpis.new_prospects).toEqual({ value: 7, previous_value: 7 });
  });

  it('fails the request when every KPI fails', async () => {
    const queryRaw = jest.fn().mockRejectedValue(new Error('database down'));

    await expect(
      getKpiValues(buildClient(queryRaw), { names: ['total_sales', 'orders_count'] }, NOW)
    ).rejects.toThrow('database down');
  });

  it('scans the previous and the selected period in a single query', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ value: '0.00', previous_value: '0.00' }]);

    await getKpiValues(buildClient(queryRaw), { ...SEPTEMBER, names: ['total_sales'] }, NOW);

    const sql = sqlOf(queryRaw, 0);
    // Span: previous start .. selected end. Split point: selected start.
    expect(isoInstants(sql)).toEqual(
      expect.arrayContaining([
        '2026-08-02T06:00:00.000Z',
        '2026-09-01T06:00:00.000Z',
        '2026-10-01T06:00:00.000Z',
      ])
    );
    expect(sql.sql).toContain('erp_status');
    expect(sql.sql).not.toMatch(/erp_created_at::date/);
  });

  it('uses the environment threshold by default and echoes it', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ value: 18, previous_value: 22 }]);

    const result = await getKpiValues(
      buildClient(queryRaw),
      { names: ['customers_without_visit'] },
      NOW
    );

    expect(result.thresholds).toEqual({
      inactivity_days: envs.INACTIVITY_THRESHOLD_DAYS,
      credit_term_days: 60,
      gps_radius_meters: 80,
    });
    expect(sqlOf(queryRaw, 0).values).toContain(envs.INACTIVITY_THRESHOLD_DAYS);
  });

  it('lets the request override the inactivity threshold', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ value: 3, previous_value: 1 }]);

    const result = await getKpiValues(
      buildClient(queryRaw),
      { inactivity_days: 60, names: ['recovered_customers'] },
      NOW
    );

    expect(result.thresholds.inactivity_days).toBe(60);
    expect(sqlOf(queryRaw, 0).values).toContain(60);
  });
});

describe('getKpi', () => {
  it('returns one KPI with its unit and previous period', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ value: '118.00', previous_value: '112.54' }]);

    const result = await getKpi(buildClient(queryRaw), 'average_ticket', SEPTEMBER, NOW);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      name: 'average_ticket',
      unit: 'money',
      has_previous_period: true,
      period: SEPTEMBER,
      previous_period: { from: '2026-08-02', to: '2026-08-31' },
      value: '118.00',
      previous_value: '112.54',
    });
  });

  it('has no previous period for a snapshot KPI', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ value: '1450.50', previous_value: null }]);

    const result = await getKpi(buildClient(queryRaw), 'overdue_portfolio', {}, NOW);

    expect(result.previous_period).toBeNull();
    expect(result.previous_value).toBeNull();
  });

  it('answers 404 for an unknown KPI without querying', async () => {
    const queryRaw = jest.fn();

    await expect(
      getKpi(buildClient(queryRaw), 'monto_cobrado', {}, NOW)
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

describe('getSellerDetail', () => {
  it('returns the seller row, weekly trend and inactive customers', async () => {
    const trend = [
      { bucket_start: '2026-08-31', stops: 12, orders_count: 10, total_sales: '1040.00', average_ticket: '104.00' },
    ];
    const inactive = [
      {
        customer_id: 'c1',
        name: 'Botica Del Valle',
        trade_name: null,
        zone: 'Escalón',
        last_visit_at: new Date('2026-08-15T15:00:00Z'),
        days_since_last_visit: 38,
      },
    ];
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([sellerRow])
      .mockResolvedValueOnce(trend)
      .mockResolvedValueOnce(inactive);

    const result = await getSellerDetail(buildClient(queryRaw), SELLER_ID, {}, NOW);

    expect(result.seller.stops_by_type).toEqual({ visit: 40, dispatch: 20, collection: 6 });
    expect(result.seller.sales_per_route).toBe('1040.00');
    expect(result.weekly_trend).toEqual(trend);
    expect(result.customers_without_visit).toEqual(inactive);
  });

  it('throws 404 when the seller does not exist', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);

    await expect(
      getSellerDetail(buildClient(queryRaw), SELLER_ID, {}, NOW)
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('getCoverage', () => {
  it('keeps customers without a pin out of the map but in the counts', async () => {
    const queryRaw = jest.fn().mockResolvedValue([
      { customer_id: 'a', name: 'A', trade_name: null, lat: 13.7, lng: -89.2, visited: true, last_visit_at: null },
      { customer_id: 'b', name: 'B', trade_name: null, lat: 13.6, lng: -89.1, visited: false, last_visit_at: null },
      { customer_id: 'c', name: 'C', trade_name: null, lat: null, lng: null, visited: true, last_visit_at: null },
    ]);

    const result = await getCoverage(buildClient(queryRaw), {}, NOW);

    expect(result.visited).toBe(2);
    expect(result.not_visited).toBe(1);
    expect(result.without_location).toBe(1);
    expect(result.customers.map((c) => c.customer_id)).toEqual(['a', 'b']);
  });
});

describe('getProductRanking', () => {
  const row = (position: number, product_id: number, amount: string) => ({
    position,
    product_id,
    code: `COD-${product_id}`,
    name: `Producto ${product_id}`,
    amount,
    units: '10.0000',
    total_amount: '5000.00',
  });

  it('keeps the ranking order and lifts the period total out of the rows', async () => {
    const queryRaw = jest.fn().mockResolvedValue([row(1, 42, '1500.00'), row(2, 7, '900.00')]);

    const result = await getProductRanking(
      buildClient(queryRaw),
      { ...SEPTEMBER, limit: 50 },
      NOW
    );

    expect(result.period).toEqual(SEPTEMBER);
    expect(result.total_amount).toBe('5000.00');
    expect(result.products).toEqual([
      { position: 1, product_id: 42, code: 'COD-42', name: 'Producto 42', amount: '1500.00', units: '10.0000' },
      { position: 2, product_id: 7, code: 'COD-7', name: 'Producto 7', amount: '900.00', units: '10.0000' },
    ]);
  });

  it('filters confirmed sales of the range and applies the limit', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);

    const result = await getProductRanking(
      buildClient(queryRaw),
      { ...SEPTEMBER, limit: 10 },
      NOW
    );

    const sql = sqlOf(queryRaw, 0);
    expect(sql.sql).toContain('s.deleted_at IS NULL');
    expect(sql.sql).toContain('s.erp_status =');
    expect(sql.sql).toContain('d.product_id IS NOT NULL');
    expect(sql.sql).toContain('p.deleted_at IS NULL');
    // Each line's quantity is in its own unit of measure: normalise to the base unit.
    expect(sql.sql).toContain('SUM(d.quantity * COALESCE(d.factor, 1))');
    // Half-open [start, end) on the raw column, never `::date` in the WHERE.
    expect(sql.sql).toContain('s.erp_created_at >=');
    expect(sql.sql).toContain('s.erp_created_at <');
    expect(sql.values).toContain(10);
    expect(isoInstants(sql)).toEqual([
      '2026-09-01T06:00:00.000Z',
      '2026-10-01T06:00:00.000Z',
    ]);
    // No sales in the period is a zero total, not a null.
    expect(result.total_amount).toBe('0.00');
    expect(result.products).toEqual([]);
  });
});

describe('getPurchaseFrequency', () => {
  it('labels the bucket counts in order', async () => {
    const queryRaw = jest.fn().mockResolvedValue([
      { bucket_counts: [5, 10, 8, 3, 1], insufficient_data: 4, average_days: 14 },
    ]);

    const result = await getPurchaseFrequency(buildClient(queryRaw), {}, NOW);

    expect(result.buckets).toEqual([
      { label: '0-7', min_days: 0, max_days: 7, customers: 5 },
      { label: '8-15', min_days: 8, max_days: 15, customers: 10 },
      { label: '16-30', min_days: 16, max_days: 30, customers: 8 },
      { label: '31-60', min_days: 31, max_days: 60, customers: 3 },
      { label: '61+', min_days: 61, max_days: null, customers: 1 },
    ]);
    expect(result.insufficient_data).toBe(4);
    expect(result.average_days).toBe(14);
  });
});
