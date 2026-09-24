import { Client } from '../lib/prisma';
import { CustomerCategory, ListCustomersQuery } from '../domain/schemas/customer.schema';
import {
  creditTotalsSql,
  customerCoreSql,
  customerListSql,
  customerListWhere,
  customerSummarySql,
  purchaseFrequencySql,
  setCustomerLocationSql,
} from './customer/customer.sql';

/*
 * Raw-SQL data access of the customers module (RF-02). Everything Prisma's
 * typed API cannot express lives here: the geography column (Unsupported in
 * Prisma) and the metrics CTE behind the A/B/C category. customer.service
 * keeps the typed Prisma reads and the business rules. The SQL text lives in
 * ./customer/*.ts.
 *
 * Every function takes the Prisma `Client`, so it runs standalone or inside a
 * $transaction, like the services.
 */

/** Row of `metrics` selected by listCustomers, one per page of the customer list. */
export interface CustomerListRow {
  id: string;
  erp_customer_id: number | null;
  name: string;
  trade_name: string | null;
  establishment_type: string | null;
  zone: string | null;
  municipality: string | null;
  attends: string | null;
  phone: string | null;
  active: boolean;
  has_gps: boolean;
  category: CustomerCategory;
  net_purchases: string;
  orders_count: number;
  visits_count: number;
  conversion_rate: number;
  avg_payment_days: number | null;
  pending_balance: string;
  total_count: number;
}

/** Row of `metrics` selected by getCustomerSummary, for a single customer. */
export interface CustomerSummaryRow {
  category: CustomerCategory;
  net_purchases: string;
  orders_count: number;
  visits_count: number;
  conversion_rate: number;
  avg_payment_days: number | null;
  pending_balance: string;
  last_purchase_at: Date | null;
  last_visit_at: Date | null;
}

/** Row of the raw geography read in getCustomerCore. */
export interface CustomerCoreRow {
  id: string;
  erp_customer_id: number | null;
  name: string;
  trade_name: string | null;
  establishment_type: string | null;
  address: string | null;
  municipality: string | null;
  zone: string | null;
  phone: string | null;
  mobile: string | null;
  attends: string | null;
  personality: string | null;
  potential: string | null;
  credit: boolean;
  credit_limit: string | null;
  origin: string | null;
  active: boolean;
  lat: number | null;
  lng: number | null;
}

/** Credit-tab totals over every outstanding invoice of the customer. */
export interface CreditTotalsRow {
  pending_balance: string;
  overdue_amount: string;
  overdue_count: number;
}

/** One page of the customer list, each row carrying the unpaged total. */
export const findCustomerPage = (
  client: Client,
  query: ListCustomersQuery
): Promise<CustomerListRow[]> => {
  const offset = (query.page - 1) * query.limit;

  return client.$queryRaw<CustomerListRow[]>(
    customerListSql(customerListWhere(query), query.limit, offset)
  );
};

/** Identity fields plus lat/lng. Undefined when the customer does not exist. */
export const findCustomerCore = async (
  client: Client,
  id: string
): Promise<CustomerCoreRow | undefined> => {
  const rows = await client.$queryRaw<CustomerCoreRow[]>(customerCoreSql(id));
  return rows[0];
};

/** Profile KPI tiles and category. Undefined when the customer does not exist. */
export const findCustomerSummary = async (
  client: Client,
  id: string
): Promise<CustomerSummaryRow | undefined> => {
  const rows = await client.$queryRaw<CustomerSummaryRow[]>(customerSummarySql(id));
  return rows[0];
};

/** Average days between consecutive purchases. Null with fewer than two. */
export const findPurchaseFrequency = async (
  client: Client,
  id: string
): Promise<number | null> => {
  const rows = await client.$queryRaw<{ frequency: number | null }[]>(
    purchaseFrequencySql(id)
  );
  return rows[0]?.frequency ?? null;
};

export const findCreditTotals = async (
  client: Client,
  id: string
): Promise<CreditTotalsRow | undefined> => {
  const rows = await client.$queryRaw<CreditTotalsRow[]>(creditTotalsSql(id));
  return rows[0];
};

/**
 * Writes the customer's GPS pin. Prisma cannot write Unsupported("geography"),
 * hence raw SQL. Returns the number of rows updated.
 */
export const setCustomerLocation = (
  client: Client,
  id: string,
  latitude: number,
  longitude: number
): Promise<number> =>
  client.$executeRaw(setCustomerLocationSql(id, latitude, longitude));
