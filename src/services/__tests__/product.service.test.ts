import { Client } from '../../lib/prisma';
import { getProductById, listProducts } from '../product.service';

const buildClient = (overrides: Record<string, unknown> = {}) =>
  ({
    product: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn() },
    ...overrides,
  }) as unknown as Client;

const productRow = (overrides: Record<string, unknown> = {}) => ({
  erp_product_id: 123,
  code: 'ABC',
  name: 'Producto',
  product_group: 'ANALGESICOS',
  last_seen_at: new Date('2026-09-01T12:00:00.000Z'),
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-09-01T12:00:00.000Z'),
  ...overrides,
});

describe('listProducts', () => {
  it('excluye productos con soft delete por defecto', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const client = buildClient({ product: { findMany, count } });

    await listProducts(client, { page: 1, limit: 20 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deleted_at: null } })
    );
    expect(count).toHaveBeenCalledWith({ where: { deleted_at: null } });
  });

  it('filtra por code o name con search', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const client = buildClient({ product: { findMany, count } });

    await listProducts(client, { page: 1, limit: 20, search: 'anti' });

    const expectedWhere = {
      deleted_at: null,
      OR: [
        { code: { contains: 'anti', mode: 'insensitive' } },
        { name: { contains: 'anti', mode: 'insensitive' } },
      ],
    };
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere })
    );
    expect(count).toHaveBeenCalledWith({ where: expectedWhere });
  });

  it('pagina con page/limit', async () => {
    const findMany = jest.fn().mockResolvedValue([productRow()]);
    const count = jest.fn().mockResolvedValue(42);
    const client = buildClient({ product: { findMany, count } });

    const page = await listProducts(client, { page: 3, limit: 10 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 })
    );
    expect(page).toMatchObject({ page: 3, page_size: 10, total: 42 });
  });
});

describe('getProductById', () => {
  it('lanza 404 si no existe o está borrado', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const client = buildClient({ product: { findFirst } });

    await expect(getProductById(client, 999)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { erp_product_id: 999, deleted_at: null },
      })
    );
  });

  it('devuelve el producto cuando existe', async () => {
    const row = productRow();
    const findFirst = jest.fn().mockResolvedValue(row);
    const client = buildClient({ product: { findFirst } });

    const result = await getProductById(client, 123);

    expect(result).toEqual(row);
  });
});
