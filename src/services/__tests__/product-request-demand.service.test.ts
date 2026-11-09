import { Client } from '../../lib/prisma';
import { CustomError } from '../../domain/errors/CustomError';
import {
  findDemandedProducts,
  findDemandProductRequests,
  findDemandProducts,
  findDemandTotals,
} from '../../repositories/productRequestDemand.repository';
import {
  getOffCatalogDemand,
  getOffCatalogProductDemand,
  listDemandedProducts,
} from '../product-request.service';

jest.mock('../../repositories/productRequestDemand.repository', () => ({
  findDemandTotals: jest.fn(),
  findDemandProducts: jest.fn(),
  findDemandProductRequests: jest.fn(),
  findDemandedProducts: jest.fn().mockResolvedValue([]),
}));

const totalsMock = findDemandTotals as jest.Mock;
const productsMock = findDemandProducts as jest.Mock;
const requestsMock = findDemandProductRequests as jest.Mock;

// 9 Nov 2026, 1 a.m. UTC: still 8 Nov in El Salvador (UTC-6).
const NOW = new Date('2026-11-09T01:00:00.000Z');
const PRODUCT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const LAST_AT = new Date('2026-11-01T20:00:00.000Z');

const client = (product: unknown = { id: PRODUCT_ID, name: 'Suero oral 500 ml' }) =>
  ({ quoted_product: { findFirst: jest.fn().mockResolvedValue(product) } }) as unknown as Client;

beforeEach(() => {
  jest.clearAllMocks();
  totalsMock.mockResolvedValue({ requests: 3, products: 2, customers: 2 });
  productsMock.mockResolvedValue([
    {
      id: PRODUCT_ID,
      name: 'Suero oral 500 ml',
      requests: 2,
      customers: 2,
      approx_quantity: '320.500',
      last_requested_at: LAST_AT,
    },
    {
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      name: 'Crema hidrocortisona 1%',
      requests: 1,
      customers: 1,
      approx_quantity: null,
      last_requested_at: LAST_AT,
    },
  ]);
  requestsMock.mockResolvedValue([]);
});

describe('getOffCatalogDemand', () => {
  it('defaults to the last 90 local days, today included', async () => {
    const result = await getOffCatalogDemand(client(), {}, NOW);

    expect(result.period).toEqual({ from: '2026-08-11', to: '2026-11-08' });
    const range = totalsMock.mock.calls[0][1];
    expect(range.start.toISOString()).toBe('2026-08-11T06:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-11-09T06:00:00.000Z');
  });

  it('counts 90 days back from an explicit `to`', async () => {
    const result = await getOffCatalogDemand(client(), { to: '2026-09-30' }, NOW);

    expect(result.period).toEqual({ from: '2026-07-03', to: '2026-09-30' });
  });

  it('uses both bounds when given', async () => {
    const result = await getOffCatalogDemand(
      client(),
      { from: '2026-09-01', to: '2026-09-30' },
      NOW
    );

    expect(result.period).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('rejects a lone `from` after today', async () => {
    await expect(getOffCatalogDemand(client(), { from: '2026-12-01' }, NOW)).rejects.toBeInstanceOf(
      CustomError
    );
    expect(totalsMock).not.toHaveBeenCalled();
  });

  it('returns totals and products, quantities as numbers or null', async () => {
    const result = await getOffCatalogDemand(client(), {}, NOW);

    expect(result.totals).toEqual({ requests: 3, products: 2, customers: 2 });
    expect(result.products.map((p) => p.approx_quantity)).toEqual([320.5, null]);
    expect(result.products[0]).toMatchObject({
      id: PRODUCT_ID,
      requests: 2,
      customers: 2,
      last_requested_at: LAST_AT,
    });
  });
});

describe('getOffCatalogProductDemand', () => {
  it('returns the product and its requests', async () => {
    requestsMock.mockResolvedValue([
      {
        id: 'request-1',
        requested_at: LAST_AT,
        requested_quantity: '12.000',
        target_kind: 'customer',
        target_id: 'customer-1',
        target_name: 'Farmacia Elena',
        seller_id: 'seller-1',
        seller_name: 'Ana',
      },
    ]);

    const result = await getOffCatalogProductDemand(client(), PRODUCT_ID, {}, NOW);

    expect(result.product).toEqual({ id: PRODUCT_ID, name: 'Suero oral 500 ml' });
    expect(result.requests[0].requested_quantity).toBe(12);
    expect(requestsMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), PRODUCT_ID);
  });

  it('answers 404 for an unknown or deleted product', async () => {
    await expect(getOffCatalogProductDemand(client(null), PRODUCT_ID, {}, NOW)).rejects.toMatchObject(
      { statusCode: 404 }
    );
  });
});

describe('listDemandedProducts', () => {
  it('treats a blank search as no search, so the most requested come first', async () => {
    await listDemandedProducts(client(), { search: '', limit: 8 });

    expect(findDemandedProducts).toHaveBeenCalledWith(expect.anything(), undefined, 8);
  });

  it('passes the search through', async () => {
    await listDemandedProducts(client(), { search: 'pediátrico', limit: 5 });

    expect(findDemandedProducts).toHaveBeenCalledWith(expect.anything(), 'pediátrico', 5);
  });
});
