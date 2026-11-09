import { Client } from '../lib/prisma';
import { LocalDateRange } from '../lib/localDateRange';
import { DemandedProduct, OffCatalogDemandTotals } from '../domain/types/product-request.types';
import {
  demandedProductsSql,
  demandProductRequestsSql,
  demandProductsSql,
  demandTotalsSql,
} from './product-requests/demand.sql';

// Quantities come back as text so numeric(12,3) keeps its digits.

export interface DemandProductRow {
  id: string;
  name: string;
  requests: number;
  customers: number;
  approx_quantity: string | null;
  last_requested_at: Date;
}

export interface DemandRequestRow {
  id: string;
  requested_at: Date;
  requested_quantity: string | null;
  target_kind: 'customer' | 'prospect' | null;
  target_id: string | null;
  target_name: string | null;
  seller_id: string | null;
  seller_name: string | null;
}

export const findDemandTotals = async (
  client: Client,
  range: LocalDateRange
): Promise<OffCatalogDemandTotals> => {
  const rows = await client.$queryRaw<OffCatalogDemandTotals[]>(demandTotalsSql(range));
  return rows[0] ?? { requests: 0, products: 0, customers: 0 };
};

export const findDemandProducts = (
  client: Client,
  range: LocalDateRange
): Promise<DemandProductRow[]> =>
  client.$queryRaw<DemandProductRow[]>(demandProductsSql(range));

export const findDemandProductRequests = (
  client: Client,
  range: LocalDateRange,
  productId: string
): Promise<DemandRequestRow[]> =>
  client.$queryRaw<DemandRequestRow[]>(demandProductRequestsSql(range, productId));

export const findDemandedProducts = (
  client: Client,
  search: string | undefined,
  limit: number
): Promise<DemandedProduct[]> =>
  client.$queryRaw<DemandedProduct[]>(demandedProductsSql(search, limit));
