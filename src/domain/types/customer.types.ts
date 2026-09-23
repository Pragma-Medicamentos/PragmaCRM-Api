import { CustomerCategory } from '../schemas/customer.schema';

/**
 * Money is carried as a string, never as a number.
 *
 * `net_total`, `total` and `pending_balance` are numeric(14,2) in Postgres.
 * Turning them into a JS number puts currency into floating point, where
 * 0.1 + 0.2 stops being 0.30. The dashboard formats the string.
 */
export type Money = string;

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Commercial figures behind the A/B/C category and the profile KPI tiles. */
export interface CustomerMetrics {
  net_purchases: Money;
  orders_count: number;
  visits_count: number;
  /** Whole percent. 0 when the customer has no visits in the window. */
  conversion_rate: number;
  /**
   * Null when the customer has no settled credit invoice in the window, which
   * the list screen renders as an em dash. Never 0 in that case: 0 would read
   * as "pays instantly", the opposite of "unknown".
   */
  avg_payment_days: number | null;
  pending_balance: Money;
}

export interface CustomerListItem extends CustomerMetrics {
  id: string;
  erp_customer_id: number | null;
  name: string;
  trade_name: string | null;
  establishment_type: string | null;
  zone: string | null;
  municipality: string | null;
  /** RF-02: "responsable de compra". Free text, captured in the dashboard. */
  attends: string | null;
  phone: string | null;
  active: boolean;
  has_gps: boolean;
  category: CustomerCategory;
}

export interface CustomerSummary extends CustomerMetrics {
  /** Average days between consecutive purchases. Null with fewer than 2. */
  purchase_frequency_days: number | null;
  last_purchase_at: Date | null;
  last_visit_at: Date | null;
}

export interface CustomerRouteRef {
  id: string;
  name: string;
}

export interface CustomerVisitNote {
  date: Date;
  notes: string;
}

export interface CustomerCore {
  id: string;
  erp_customer_id: number | null;
  name: string;
  trade_name: string | null;
  establishment_type: string | null;
  address: string | null;
  place_id: string | null;
  municipality: string | null;
  zone: string | null;
  phone: string | null;
  mobile: string | null;
  attends: string | null;
  personality: string | null;
  potential: string | null;
  credit: boolean;
  credit_limit: Money | null;
  origin: string | null;
  active: boolean;
  /** Read through $queryRaw: Prisma cannot select an Unsupported("geography"). */
  location: GeoPoint | null;
}

export interface CustomerProfile extends CustomerCore {
  category: CustomerCategory;
  routes: CustomerRouteRef[];
  summary: CustomerSummary;
  pending_balance: Money;
  recent_notes: CustomerVisitNote[];
}

/**
 * How a settled sale came to be settled, from `payment_id`.
 *
 * The ERP flips the value itself when an invoice is collected: a credit sale
 * moves from id_pago 5 (Crédito, outstanding) to 6 (Crédito Pagado, settled).
 * A cash sale is born as 1. Verified against the real export with no exception
 * in 344 records.
 */
export type SalePaymentType = 'cash' | 'credit_settled';

/**
 * A settled sale: erp_status = 2 with no outstanding balance. Anything still
 * owed lives in CustomerCreditItem instead — the two are disjoint.
 */
export interface CustomerSaleItem {
  erp_sale_id: number;
  erp_created_at: Date | null;
  document: string | null;
  seller: { id: string; name: string } | null;
  total: Money;
  payment_type: SalePaymentType;
  /** When it was collected. Same as erp_created_at for a cash sale. */
  paid_at: Date | null;
  /**
   * Days the customer took to pay. Null for cash: there was never any credit
   * to pay, so 0 would read as "pays instantly" rather than "not applicable".
   */
  payment_days: number | null;
}

export interface CustomerCreditItem {
  erp_sale_id: number;
  document: string | null;
  erp_created_at: Date | null;
  total: Money;
  pending_balance: Money;
  days_since_sale: number;
  overdue: boolean;
  days_overdue: number;
}

export interface CustomerCreditTotals {
  pending_balance: Money;
  overdue_amount: Money;
  overdue_count: number;
  credit_limit: Money | null;
  credit_available: Money | null;
}
