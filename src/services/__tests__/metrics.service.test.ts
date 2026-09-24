import { Prisma } from '../../generated/prisma/client';
import { Client } from '../../lib/prisma';
import { envs } from '../../config/envs';
import {
  getCompanyKpis,
  getCoverage,
  getPurchaseFrequency,
  getSellerDetail,
} from '../metrics.service';

const NOW = new Date('2026-09-22T18:00:00Z');
const SELLER_ID = '11111111-1111-1111-1111-111111111101';

const periodRow = (overrides: Record<string, unknown> = {}) => ({
  stops_executed: 62,
  stops_visit: 41,
  stops_dispatch: 12,
  stops_collection: 9,
  visited_customers: 40,
  effective_visits_rate: 85.5,
  average_visit_minutes: 14.2,
  total_sales: '7316.00',
  orders_count: 62,
  average_ticket: '118.00',
  average_monthly_sales: '7316.00',
  route_effectiveness: '1180.00',
  goal_compliance: 91.2,
  customers_without_visit: 18,
  recovered_customers: 3,
  purchase_frequency_days: 11,
  new_prospects: 7,
  ...overrides,
});

const snapshotRow = { overdue_portfolio: '1450.50', pending_collections: '3200.00' };

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

/** Flattens a Prisma.Sql into its text and values, to inspect what was sent. */
const sqlOf = (mock: jest.Mock, call: number) => mock.mock.calls[call][0] as Prisma.Sql;

describe('getCompanyKpis', () => {
  it('pairs every KPI with its previous-period value', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([periodRow()])
      .mockResolvedValueOnce([periodRow({ stops_executed: 57, goal_compliance: null })])
      .mockResolvedValueOnce([snapshotRow]);

    const result = await getCompanyKpis(
      buildClient(queryRaw),
      { from: '2026-09-01', to: '2026-09-30' },
      NOW
    );

    expect(result.period).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(result.previous_period).toEqual({ from: '2026-08-02', to: '2026-08-31' });
    expect(result.kpis.stops_executed).toEqual({ value: 62, previous_value: 57 });
    expect(result.kpis.stops_by_type?.value).toEqual({ visit: 41, dispatch: 12, collection: 9 });
    expect(result.kpis.goal_compliance).toEqual({ value: 91.2, previous_value: null });
    expect(result.kpis.average_ticket?.value).toBe('118.00');
  });

  it('reports snapshot KPIs without a previous value', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([periodRow()])
      .mockResolvedValueOnce([periodRow()])
      .mockResolvedValueOnce([snapshotRow]);

    const { kpis } = await getCompanyKpis(buildClient(queryRaw), {}, NOW);

    expect(kpis.overdue_portfolio).toEqual({ value: '1450.50', previous_value: null });
    expect(kpis.pending_collections).toEqual({ value: '3200.00', previous_value: null });
  });

  it('returns every KPI when none is selected', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ ...periodRow(), ...snapshotRow }]);

    const { kpis } = await getCompanyKpis(buildClient(queryRaw), {}, NOW);

    expect(Object.keys(kpis)).toHaveLength(17);
    expect(queryRaw).toHaveBeenCalledTimes(3);
  });

  it('returns only the selected KPIs, in the requested order', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([periodRow()])
      .mockResolvedValueOnce([periodRow({ stops_executed: 57 })]);

    const { kpis } = await getCompanyKpis(
      buildClient(queryRaw),
      { kpis: ['new_prospects', 'stops_executed'] },
      NOW
    );

    expect(Object.keys(kpis)).toEqual(['new_prospects', 'stops_executed']);
    expect(kpis.stops_executed).toEqual({ value: 62, previous_value: 57 });
    // No snapshot KPI requested: the collections query is skipped.
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it('skips both period queries when only snapshot KPIs are requested', async () => {
    const queryRaw = jest.fn().mockResolvedValueOnce([snapshotRow]);

    const { kpis } = await getCompanyKpis(
      buildClient(queryRaw),
      { kpis: ['overdue_portfolio'] },
      NOW
    );

    expect(kpis).toEqual({ overdue_portfolio: { value: '1450.50', previous_value: null } });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('uses the environment threshold by default and echoes it', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ ...periodRow(), ...snapshotRow }]);

    const result = await getCompanyKpis(buildClient(queryRaw), {}, NOW);

    expect(result.thresholds).toEqual({
      inactivity_days: envs.INACTIVITY_THRESHOLD_DAYS,
      credit_term_days: 60,
      gps_radius_meters: 80,
    });
    expect(sqlOf(queryRaw, 0).values).toContain(envs.INACTIVITY_THRESHOLD_DAYS);
  });

  it('lets the request override the inactivity threshold', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ ...periodRow(), ...snapshotRow }]);

    const result = await getCompanyKpis(buildClient(queryRaw), { inactivity_days: 60 }, NOW);

    expect(result.thresholds.inactivity_days).toBe(60);
    expect(sqlOf(queryRaw, 0).values).toContain(60);
    expect(sqlOf(queryRaw, 1).values).toContain(60);
  });

  it('filters sales and visits with the local bounds of the range', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ ...periodRow(), ...snapshotRow }]);

    await getCompanyKpis(buildClient(queryRaw), { from: '2026-09-01', to: '2026-09-30' }, NOW);

    const sql = sqlOf(queryRaw, 0);
    const instants = sql.values
      .filter((value): value is Date => value instanceof Date)
      .map((value) => value.toISOString());
    expect(instants).toContain('2026-09-01T06:00:00.000Z');
    expect(instants).toContain('2026-10-01T06:00:00.000Z');
    expect(sql.sql).toContain('erp_status');
    expect(sql.sql).not.toMatch(/erp_created_at::date/);
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
