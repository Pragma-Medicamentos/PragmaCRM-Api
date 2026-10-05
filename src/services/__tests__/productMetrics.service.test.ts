import { Prisma } from '../../generated/prisma/client';
import { Client } from '../../lib/prisma';
import { ERP_STATUS_SALE } from '../../domain/constants/businessRules';
import {
  ABC_CLASS_A_MAX_SHARE,
  ABC_CLASS_B_MAX_SHARE,
} from '../../domain/constants/productMetrics';
import {
  getProductDetail,
  getProductsWithoutMovement,
} from '../productMetrics.service';

const NOW = new Date('2026-09-22T18:00:00Z');
const SEPTEMBER = { from: '2026-09-01', to: '2026-09-30' };
/** The 30 days right before September: what previousRange() builds from it. */
const AUGUST_TAIL = { from: '2026-08-02', to: '2026-08-31' };
const PRODUCT_ID = 42;

const buildClient = (queryRaw: jest.Mock) => ({ $queryRaw: queryRaw }) as unknown as Client;

/** The Prisma.Sql sent on a given $queryRaw call, to inspect text and values. */
const sqlOf = (mock: jest.Mock, call: number) => mock.mock.calls[call][0] as Prisma.Sql;

const isoInstants = (sql: Prisma.Sql) =>
  sql.values
    .filter((value): value is Date => value instanceof Date)
    .map((value) => value.toISOString());

/** A product that sold: the row the detail query returns, already computed. */
const detailRow = {
  product_id: PRODUCT_ID,
  code: 'ABC-1',
  name: 'Producto X',
  product_group: 'Analgésicos',
  position: 1,
  amount: '1500.00',
  units: '120.0000',
  period_total_amount: '5000.00',
  share_percent: 30,
  invoices: 12,
  average_ticket: '125.00',
  customers: 9,
  portfolio_customers: 45,
  penetration_percent: 20,
  abc_class: 'A' as const,
  previous_amount: '1200.00',
  change_percent: 25,
};

/** Same product in a period where it sold nothing. */
const emptyDetailRow = {
  ...detailRow,
  position: null,
  amount: '0.00',
  units: '0.0000',
  period_total_amount: '5000.00',
  share_percent: 0,
  invoices: 0,
  average_ticket: '0.00',
  customers: 0,
  penetration_percent: 0,
  abc_class: null,
  previous_amount: '0.00',
  change_percent: null,
};

const sellerRows = [
  { user_id: '11111111-1111-1111-1111-111111111101', name: 'Rosa Alvarado', amount: '900.00', units: '72.0000' },
  { user_id: '11111111-1111-1111-1111-111111111102', name: 'Luis Mejía', amount: '600.00', units: '48.0000' },
];

describe('getProductDetail', () => {
  it('returns the product sheet with its ranking, penetration and trend', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([detailRow])
      .mockResolvedValueOnce(sellerRows);

    const result = await getProductDetail(buildClient(queryRaw), PRODUCT_ID, SEPTEMBER, NOW);

    expect(result.period).toEqual(SEPTEMBER);
    expect(result.product).toEqual({
      product_id: PRODUCT_ID,
      code: 'ABC-1',
      name: 'Producto X',
      product_group: 'Analgésicos',
    });
    expect(result.amount).toBe('1500.00');
    expect(result.units).toBe('120.0000');
    expect(result.position).toBe(1);
    expect(result.invoices).toBe(12);
    expect(result.average_ticket).toBe('125.00');
    expect(result.customers).toBe(9);
    expect(result.portfolio_customers).toBe(45);
    expect(result.penetration_percent).toBe(20);
    expect(result.abc_class).toBe('A');
    expect(result.sellers).toEqual(sellerRows);
    expect(result.trend).toEqual({
      previous_period: AUGUST_TAIL,
      previous_amount: '1200.00',
      change_percent: 25,
    });
  });

  it('reports the share against the same total the ranking returns', async () => {
    const queryRaw = jest.fn().mockResolvedValueOnce([detailRow]).mockResolvedValueOnce([]);

    const result = await getProductDetail(buildClient(queryRaw), PRODUCT_ID, SEPTEMBER, NOW);

    expect(result.period_total_amount).toBe('5000.00');
    expect(result.share_percent).toBe(
      Number(((Number(result.amount) * 100) / Number(result.period_total_amount)).toFixed(1))
    );
  });

  it('answers zeros, not a 500, for a product with no sales in the range', async () => {
    const queryRaw = jest.fn().mockResolvedValueOnce([emptyDetailRow]).mockResolvedValueOnce([]);

    const result = await getProductDetail(buildClient(queryRaw), PRODUCT_ID, SEPTEMBER, NOW);

    expect(result.amount).toBe('0.00');
    expect(result.units).toBe('0.0000');
    expect(result.invoices).toBe(0);
    expect(result.average_ticket).toBe('0.00');
    expect(result.share_percent).toBe(0);
    expect(result.penetration_percent).toBe(0);
    expect(result.position).toBeNull();
    expect(result.abc_class).toBeNull();
    expect(result.sellers).toEqual([]);
  });

  it('leaves the trend null when the previous period sold nothing', async () => {
    const queryRaw = jest.fn().mockResolvedValueOnce([emptyDetailRow]).mockResolvedValueOnce([]);

    const result = await getProductDetail(buildClient(queryRaw), PRODUCT_ID, SEPTEMBER, NOW);

    expect(result.trend).toEqual({
      previous_period: AUGUST_TAIL,
      previous_amount: '0.00',
      change_percent: null,
    });
  });

  it('404s when the product does not exist or is deleted', async () => {
    const queryRaw = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await expect(
      getProductDetail(buildClient(queryRaw), PRODUCT_ID, SEPTEMBER, NOW)
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('reuses the ranking query instead of restating it, and its ABC cuts', async () => {
    const queryRaw = jest.fn().mockResolvedValueOnce([detailRow]).mockResolvedValueOnce([]);

    await getProductDetail(buildClient(queryRaw), PRODUCT_ID, SEPTEMBER, NOW);

    const detailSql = sqlOf(queryRaw, 0);
    // The ranking is embedded verbatim: same ROW_NUMBER, same tie-break.
    expect(detailSql.sql).toContain('ROW_NUMBER() OVER (ORDER BY sold.amount DESC');
    expect(detailSql.sql).toContain('sold.product_id ASC');
    expect(detailSql.values).toContain(ERP_STATUS_SALE);
    expect(detailSql.values).toContain(ABC_CLASS_A_MAX_SHARE);
    expect(detailSql.values).toContain(ABC_CLASS_B_MAX_SHARE);
    // Current and previous period are read in one pass.
    expect(isoInstants(detailSql)).toEqual(
      expect.arrayContaining([
        '2026-09-01T06:00:00.000Z',
        '2026-10-01T06:00:00.000Z',
        '2026-08-02T06:00:00.000Z',
      ])
    );
  });

  it('asks the sellers only for the selected period', async () => {
    const queryRaw = jest.fn().mockResolvedValueOnce([detailRow]).mockResolvedValueOnce([]);

    await getProductDetail(buildClient(queryRaw), PRODUCT_ID, SEPTEMBER, NOW);

    const sellersSql = sqlOf(queryRaw, 1);
    expect(sellersSql.values).toContain(PRODUCT_ID);
    expect(isoInstants(sellersSql)).toEqual([
      '2026-09-01T06:00:00.000Z',
      '2026-10-01T06:00:00.000Z',
    ]);
  });
});

describe('getProductsWithoutMovement', () => {
  const quietProduct = {
    product_id: 7,
    code: 'Q-7',
    name: 'Producto quieto',
    product_group: null,
    last_sold_at: new Date('2026-05-10T18:00:00Z'),
    days_since_last_sale: 143,
  };

  it('lists the quiet products with the 30/60/90 counts', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([quietProduct])
      .mockResolvedValueOnce([{ active_products: 310, days_30: 120, days_60: 80, days_90: 55 }]);

    const result = await getProductsWithoutMovement(buildClient(queryRaw), SEPTEMBER, NOW);

    expect(result.period).toEqual(SEPTEMBER);
    expect(result.products).toEqual([quietProduct]);
    expect(result.active_products).toBe(310);
    expect(result.without_movement).toEqual({ days_30: 120, days_60: 80, days_90: 55 });
  });

  it('counts the windows back from the end of the range, not from today', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ active_products: 0, days_30: 0, days_60: 0, days_90: 0 }]);

    await getProductsWithoutMovement(buildClient(queryRaw), SEPTEMBER, NOW);

    // 30, 60 and 90 days before 1 Oct 00:00 local (= 06:00 UTC).
    expect(isoInstants(sqlOf(queryRaw, 1))).toEqual(
      expect.arrayContaining([
        '2026-09-01T06:00:00.000Z',
        '2026-08-02T06:00:00.000Z',
        '2026-07-03T06:00:00.000Z',
      ])
    );
  });

  it('answers zeros when the catalog is empty', async () => {
    const queryRaw = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const result = await getProductsWithoutMovement(buildClient(queryRaw), SEPTEMBER, NOW);

    expect(result.products).toEqual([]);
    expect(result.active_products).toBe(0);
    expect(result.without_movement).toEqual({ days_30: 0, days_60: 0, days_90: 0 });
  });
});
