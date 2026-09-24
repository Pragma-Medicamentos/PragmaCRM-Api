import { Client } from '../lib/prisma';
import { CustomError } from '../domain/errors/CustomError';
import { ListProductsQuery } from '../domain/schemas/product.schema';
import { ProductListItem } from '../domain/types/product.types';
import { Paginated, buildPage } from '../domain/types/pagination.types';

const PRODUCT_SELECT = {
  erp_product_id: true,
  code: true,
  name: true,
  product_group: true,
  last_seen_at: true,
  created_at: true,
  updated_at: true,
} as const;

/*
 * ============================================================================
 * MAIN METHODS — called directly by ProductsController, one per route:
 *
 *   GET /api/v1/products      -> listProducts
 *   GET /api/v1/products/:id -> getProductById
 *
 * Read-only: Efactsoft import (salesSync.service.ts) is the only writer.
 * ============================================================================
 */

export const listProducts = async (
  client: Client,
  query: ListProductsQuery
): Promise<Paginated<ProductListItem>> => {
  const where = {
    deleted_at: null,
    ...(query.search
      ? {
          OR: [
            { code: { contains: query.search, mode: 'insensitive' as const } },
            { name: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    client.product.findMany({
      where,
      select: PRODUCT_SELECT,
      orderBy: { name: 'asc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    client.product.count({ where }),
  ]);

  return buildPage(rows, total, query.page, query.limit);
};

export const getProductById = async (
  client: Client,
  id: number
): Promise<ProductListItem> => {
  const product = await client.product.findFirst({
    where: { erp_product_id: id, deleted_at: null },
    select: PRODUCT_SELECT,
  });

  if (!product) throw CustomError.notFound('Product not found');

  return product;
};
