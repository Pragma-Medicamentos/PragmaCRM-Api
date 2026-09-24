import { Client } from '../lib/prisma';
import { LocalDateRange } from '../lib/localDateRange';
import { TrendGranularity } from '../domain/schemas/metrics.schema';
import { Money } from '../domain/types/customer.types';
import { InactiveCustomer, TrendPoint } from '../domain/types/metrics.types';
import { periodKpisSql, snapshotKpisSql } from './metrics/kpis.sql';
import { sellerInactiveCustomersSql, sellerPerformanceSql } from './metrics/sellers.sql';
import { trendsSql } from './metrics/trends.sql';
import { coverageSql } from './metrics/coverage.sql';
import { purchaseFrequencySql } from './metrics/purchaseFrequency.sql';

/*
 * Data access of the metrics panel (RF-09). Every raw SQL statement of the
 * module runs here; metrics.service only resolves ranges and thresholds and
 * shapes the rows into the response. The SQL text lives in ./metrics/*.sql.ts.
 *
 * Every function takes the Prisma `Client`, so it runs standalone or inside a
 * $transaction, like the services.
 */

export interface PeriodKpiRow {
  stops_executed: number;
  stops_visit: number;
  stops_dispatch: number;
  stops_collection: number;
  visited_customers: number;
  effective_visits_rate: number | null;
  average_visit_minutes: number | null;
  total_sales: Money;
  orders_count: number;
  average_ticket: Money | null;
  average_monthly_sales: Money;
  route_effectiveness: Money | null;
  goal_compliance: number | null;
  customers_without_visit: number;
  recovered_customers: number;
  purchase_frequency_days: number | null;
  new_prospects: number;
}

export interface SnapshotKpiRow {
  overdue_portfolio: Money;
  pending_collections: Money;
}

export interface SellerRow {
  user_id: string;
  name: string;
  active: boolean;
  stops_executed: number;
  stops_visit: number;
  stops_dispatch: number;
  stops_collection: number;
  visited_customers: number;
  orders_count: number;
  total_sales: Money;
  average_ticket: Money | null;
  goal_amount: Money | null;
  goal_compliance: number | null;
  route_sales: Money;
  executed_route_days: number;
  sales_per_route: Money | null;
  dispatches_for_others: number;
  portfolio_customers: number;
}

export interface CoverageRow {
  customer_id: string;
  name: string;
  trade_name: string | null;
  lat: number | null;
  lng: number | null;
  visited: boolean;
  last_visit_at: Date | null;
}

export interface PurchaseFrequencyRow {
  bucket_counts: number[];
  insufficient_data: number;
  average_days: number | null;
}

/** Every period-dependent company KPI, in a single row. */
export const findPeriodKpis = async (
  client: Client,
  range: LocalDateRange,
  inactivityDays: number,
  now: Date
): Promise<PeriodKpiRow> => {
  const rows = await client.$queryRaw<PeriodKpiRow[]>(
    periodKpisSql(range, inactivityDays, now)
  );
  return rows[0];
};

/** Collections as of today: overdue portfolio and pending collections. */
export const findSnapshotKpis = async (client: Client): Promise<SnapshotKpiRow> => {
  const rows = await client.$queryRaw<SnapshotKpiRow[]>(snapshotKpisSql());
  return rows[0];
};

/** One row per seller, or only the given seller when `sellerId` is set. */
export const findSellerPerformance = (
  client: Client,
  range: LocalDateRange,
  sellerId?: string
): Promise<SellerRow[]> =>
  client.$queryRaw<SellerRow[]>(sellerPerformanceSql(range, sellerId));

/** Customers of the seller's routes whose last visit exceeds the threshold. */
export const findSellerInactiveCustomers = (
  client: Client,
  sellerId: string,
  referenceAt: Date,
  inactivityDays: number
): Promise<InactiveCustomer[]> =>
  client.$queryRaw<InactiveCustomer[]>(
    sellerInactiveCustomersSql(sellerId, referenceAt, inactivityDays)
  );

/** Stops and sales per local week or month, optionally for one seller. */
export const findTrends = (
  client: Client,
  range: LocalDateRange,
  granularity: TrendGranularity,
  sellerId?: string
): Promise<TrendPoint[]> =>
  client.$queryRaw<TrendPoint[]>(trendsSql(range, granularity, sellerId));

/** Active customers, flagged visited when they had a visit in the range. */
export const findCoverage = (
  client: Client,
  range: LocalDateRange
): Promise<CoverageRow[]> => client.$queryRaw<CoverageRow[]>(coverageSql(range));

/** Customers per purchase-frequency bucket. Undefined never happens in practice. */
export const findPurchaseFrequencyBuckets = async (
  client: Client,
  range: LocalDateRange
): Promise<PurchaseFrequencyRow | undefined> => {
  const rows = await client.$queryRaw<PurchaseFrequencyRow[]>(purchaseFrequencySql(range));
  return rows[0];
};
