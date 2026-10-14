import { Prisma } from '../../generated/prisma/client';
import { Client } from '../../lib/prisma';
import { ERP_STATUS_SALE } from '../../domain/constants/businessRules';
import {
  getProductCustomers,
  getProductDetail,
  getProductsWithoutMovement,
} from '../productMetrics.service';

const NOW = new Date('2026-09-22T18:00:00Z');
const SEPTEMBER = { from: '2026-09-01', to: '2026-09-30' };
/** September's [start, end) instants in America/El_Salvador. */
const SEPTEMBER_BOUNDS = ['2026-09-01T06:00:00.000Z', '2026-10-01T06:00:00.000Z'];
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
  amount: '1500.00',
  units: '120.0000',
  average_ticket: '125.00',
};

/** Same product in a period where it sold nothing. */
const emptyDetailRow = {
  ...detailRow,
  amount: '0.00',
  units: '0.0000',
  average_ticket: '0.00',
};

const sellerRows = [
  { user_id: '11111111-1111-1111-1111-111111111101', name: 'Rosa Alvarado', amount: '900.00', units: '72.0000' },
  { user_id: '11111111-1111-1111-1111-111111111102', name: 'Luis Mejía', amount: '600.00', units: '48.0000' },
];

describe('getProductDetail', () => {
  it('returns the product sheet with its sellers', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([detailRow])
      .mockResolvedValueOnce(sellerRows);

    const result = await getProductDetail(buildClient(queryRaw), PRODUCT_ID, SEPTEMBER, NOW);

    expect(result).toEqual({
      period: SEPTEMBER,
      thresholds: expect.any(Object),
      product: {
        product_id: PRODUCT_ID,
        code: 'ABC-1',
        name: 'Producto X',
        product_group: 'Analgésicos',
      },
      amount: '1500.00',
      units: '120.0000',
      average_ticket: '125.00',
      sellers: sellerRows,
    });
  });

  it('answers zeros, not a 404, for a product with no sales in the range', async () => {
    const queryRaw = jest.fn().mockResolvedValueOnce([emptyDetailRow]).mockResolvedValueOnce([]);

    const result = await getProductDetail(buildClient(queryRaw), PRODUCT_ID, SEPTEMBER, NOW);

    expect(result.amount).toBe('0.00');
    expect(result.units).toBe('0.0000');
    expect(result.average_ticket).toBe('0.00');
    expect(result.sellers).toEqual([]);
  });

  it('404s when the product does not exist or is deleted', async () => {
    const queryRaw = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await expect(
      getProductDetail(buildClient(queryRaw), PRODUCT_ID, SEPTEMBER, NOW)
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('reads only confirmed sales of the selected period', async () => {
    const queryRaw = jest.fn().mockResolvedValueOnce([detailRow]).mockResolvedValueOnce([]);

    await getProductDetail(buildClient(queryRaw), PRODUCT_ID, SEPTEMBER, NOW);

    for (const call of [0, 1]) {
      const sql = sqlOf(queryRaw, call);
      expect(sql.values).toContain(PRODUCT_ID);
      expect(sql.values).toContain(ERP_STATUS_SALE);
      expect(isoInstants(sql)).toEqual(SEPTEMBER_BOUNDS);
    }
  });
});

describe('getProductCustomers', () => {
  const customerRows = [
    {
      customer_id: 'cccccccc-cccc-cccc-cccc-cccccccccc01',
      name: 'Farmacia Central',
      trade_name: 'Central',
      amount: '800.00',
      units: '64.0000',
      invoices: 5,
      last_purchase_at: new Date('2026-09-20T16:00:00Z'),
    },
  ];

  it('returns one page of buyers with the paging totals', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([{ product_exists: true, total: 45 }])
      .mockResolvedValueOnce(customerRows);

    const result = await getProductCustomers(
      buildClient(queryRaw),
      PRODUCT_ID,
      { ...SEPTEMBER, page: 2, limit: 20 },
      NOW
    );

    expect(result.period).toEqual(SEPTEMBER);
    expect(result.items).toEqual(customerRows);
    expect(result).toMatchObject({ page: 2, page_size: 20, total: 45, total_pages: 3 });
  });

  it('turns the page into LIMIT and OFFSET', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([{ product_exists: true, total: 45 }])
      .mockResolvedValueOnce([]);

    await getProductCustomers(buildClient(queryRaw), PRODUCT_ID, { ...SEPTEMBER, page: 3, limit: 20 }, NOW);

    const pageSql = sqlOf(queryRaw, 1);
    expect(pageSql.sql).toMatch(/LIMIT\s+\?\s+OFFSET\s+\?/);
    expect(pageSql.values.slice(-2)).toEqual([20, 40]);
    expect(isoInstants(pageSql)).toEqual(SEPTEMBER_BOUNDS);
  });

  it('keeps the total on a page past the end', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([{ product_exists: true, total: 3 }])
      .mockResolvedValueOnce([]);

    const result = await getProductCustomers(
      buildClient(queryRaw),
      PRODUCT_ID,
      { ...SEPTEMBER, page: 9, limit: 20 },
      NOW
    );

    expect(result).toMatchObject({ items: [], total: 3, total_pages: 1 });
  });

  it('404s when the product does not exist or is deleted', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([{ product_exists: false, total: 0 }])
      .mockResolvedValueOnce([]);

    await expect(
      getProductCustomers(buildClient(queryRaw), PRODUCT_ID, { ...SEPTEMBER, page: 1, limit: 20 }, NOW)
    ).rejects.toMatchObject({ statusCode: 404 });
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
