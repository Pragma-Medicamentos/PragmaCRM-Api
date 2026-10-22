import { Money } from './customer.types';
import { MetricsPeriod } from './metrics.types';

/*
 * Rows of the management reports (PCRM-159), as the SQL in
 * repositories/reports/ returns them. Money is the API's decimal string
 * (`"118.00"`); the builders turn it into numbers for the file.
 */

/** One group of GET /reports/sales/:group. `key` NULL = dimension unknown. */
export interface SalesGroupRow {
  key: string | null;
  label: string | null;
  /** Trade name (customer), zone (route) or code (product). */
  detail: string | null;
  amount: Money;
  orders_count: number;
  customers: number;
  /** Base units sold; only for the product group. */
  units: string | null;
}

export interface SellerComparisonRow {
  key: string | null;
  label: string | null;
  cur_amount: Money;
  cur_orders: number;
  prev_amount: Money;
  prev_orders: number;
}

export interface NewCustomerRow {
  customer_id: string;
  erp_customer_id: number | null;
  name: string;
  trade_name: string | null;
  first_purchase_at: Date;
  seller_name: string | null;
  route_name: string | null;
  zone: string | null;
  amount: Money;
  orders_count: number;
}

export interface RecoveredCustomerRow {
  customer_id: string;
  erp_customer_id: number | null;
  name: string;
  trade_name: string | null;
  previous_purchase_at: Date;
  recovered_at: Date;
  days_inactive: number;
  seller_name: string | null;
  route_name: string | null;
  amount: Money;
}

export interface CustomerWithoutPurchaseRow {
  customer_id: string;
  erp_customer_id: number | null;
  name: string;
  trade_name: string | null;
  last_purchase_at: Date;
  days_without_purchase: number;
  last_amount: Money | null;
  seller_name: string | null;
  routes: string | null;
}

export interface PlannedVsDoneRow {
  seller_name: string | null;
  route_name: string | null;
  zone: string | null;
  planned: number;
  planned_done: number;
  extra: number;
  extra_done: number;
  outside_agenda: number;
  compliance: number | null;
}

export interface VisitEffectivenessRow {
  seller_name: string | null;
  visits: number;
  visits_with_order: number;
  effectiveness: number | null;
  marked_successful: number;
  marked_successful_rate: number | null;
  amount: Money;
}

export interface CollectionsRow {
  seller_name: string | null;
  collected: Money;
  payments: number;
  pending: Money;
  overdue: Money;
  pending_invoices: number;
}

export interface OverdueInvoiceRow {
  erp_sale_id: number;
  document: string | null;
  erp_customer_id: number | null;
  customer_name: string | null;
  trade_name: string | null;
  issued_at: Date;
  days_overdue: number;
  total: Money | null;
  pending_balance: Money;
  seller_name: string | null;
  route_name: string | null;
  zone: string | null;
}

export interface GoalRow {
  seller_name: string;
  active: boolean;
  goal_amount: Money | null;
  goal_sales: Money | null;
  compliance: number | null;
  total_sales: Money;
}

/**
 * What every management report builder receives besides its rows: the
 * resolved period, the filters as the user picked them (names, not ids) and
 * who downloaded it.
 */
export interface ManagementReportContext {
  period: MetricsPeriod;
  generatedAt: Date;
  generatedBy?: string;
  /** Applied filters, already labelled: `{ label: 'Vendedor', value: 'Ana' }`. */
  filters: { label: string; value: string }[];
}
