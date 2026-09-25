import { Prisma } from '../generated/prisma/client';
import { Client } from '../lib/prisma';
import { CustomError } from '../domain/errors/CustomError';
import {
  CustomerCategory,
  ListCustomerSalesQuery,
  ListCustomersQuery,
  UpdateCustomerContactInput,
  UpdateCustomerLocationInput,
} from '../domain/schemas/customer.schema';
import { PaginationQuery } from '../domain/schemas/pagination.schema';
import {
  CustomerCore,
  CustomerCreditItem,
  CustomerCreditTotals,
  CustomerListItem,
  CustomerProfile,
  CustomerRouteRef,
  CustomerSaleItem,
  CustomerSummary,
  CustomerVisitNote,
} from '../domain/types/customer.types';
import { Paginated, buildPage } from '../domain/types/pagination.types';
import {
  CASH_PAYMENT_ID,
  CREDIT_TERM_DAYS,
  ERP_STATUS_SALE,
} from '../domain/constants/businessRules';
import {
  CustomerCoreRow,
  findCreditTotals,
  findCustomerCore,
  findCustomerPage,
  findCustomerSummary,
  findPurchaseFrequency,
  setCustomerLocation,
} from '../repositories/customer.repository';

// Sale-wide rules (erp_status, cash, credit term) live in
// domain/constants/businessRules.ts and the A/B/C settings in
// domain/constants/customerCategory.ts. Every raw SQL statement of this module
// runs in repositories/customer.repository.ts; this service keeps the typed
// Prisma reads and the business rules.

/*
 * ============================================================================
 * 1. MAIN METHODS — called directly by CustomersController, one per route:
 *
 *      GET   /api/v1/customers             -> listCustomers
 *      GET   /api/v1/customers/:id         -> getCustomerProfile
 *      GET   /api/v1/customers/:id/sales   -> assertCustomerExists, listCustomerSales
 *      GET   /api/v1/customers/:id/credits -> getCreditStatus
 *      PATCH /api/v1/customers/:id/location -> updateCustomerLocation
 * ============================================================================
 */

export const listCustomers = async (
  client: Client,
  query: ListCustomersQuery
): Promise<Paginated<CustomerListItem>> => {
  const rows = await findCustomerPage(client, query);

  const total = rows[0]?.total_count ?? 0;
  const items = rows.map(({ total_count: _total, ...item }) => item);

  return buildPage(items, total, query.page, query.limit);
};

/**
 * Everything the customer profile screen needs, in one call.
 *
 * Composes the granular readers from section 2 rather than inlining them: the
 * mobile stop screen (PCRM-46) needs a narrower projection built from the
 * same parts.
 */
export const getCustomerProfile = async (
  client: Client,
  id: string
): Promise<CustomerProfile> => {
  const core = await getCustomerCore(client, id);

  const [summary, routes, notes] = await Promise.all([
    getCustomerSummary(client, id),
    getCustomerRoutes(client, id),
    getRecentVisitNotes(client, id),
  ]);

  const { category, ...metrics } = summary;

  return {
    ...core,
    category,
    routes,
    summary: metrics,
    pending_balance: metrics.pending_balance,
    recent_notes: notes,
  };
};

/**
 * Sales history: settled sales only.
 *
 * erp_status = 2 AND pending_balance = 0. Together with getCreditStatus this
 * partitions every confirmed sale exactly once — a given erp_sale_id is in one
 * list or the other, never both and never neither.
 *
 * An invoice migrates between the two over time: a credit sale sits in
 * /credits until it is collected, then the next import zeroes its balance and
 * it surfaces here. That transition is derived from the current
 * pending_balance, not stored — the column is overwritten on every upload, and
 * balance_snapshot is what keeps the history.
 */
export const listCustomerSales = async (
  client: Client,
  id: string,
  query: ListCustomerSalesQuery
): Promise<Paginated<CustomerSaleItem>> => {
  // Range predicates on the raw column, never `::date` in the WHERE: casting
  // discards the partial index and shifts evening sales to the next day
  // (CLAUDE.md 5.7).
  const createdAt =
    query.from || query.to
      ? {
          ...(query.from ? { gte: query.from } : {}),
          ...(query.to ? { lte: query.to } : {}),
        }
      : undefined;

  const where = {
    customer_id: id,
    deleted_at: null,
    erp_status: ERP_STATUS_SALE,
    pending_balance: 0,
    ...(createdAt ? { erp_created_at: createdAt } : {}),
  };

  const [rows, total] = await Promise.all([
    client.sale.findMany({
      where,
      select: {
        erp_sale_id: true,
        erp_created_at: true,
        document: true,
        total: true,
        payment_id: true,
        last_payment_at: true,
        app_user: { select: { id: true, name: true } },
      },
      orderBy: { erp_created_at: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    client.sale.count({ where }),
  ]);

  const items: CustomerSaleItem[] = rows.map((row) => {
    const isCash = row.payment_id === CASH_PAYMENT_ID;

    return {
      erp_sale_id: row.erp_sale_id,
      erp_created_at: row.erp_created_at,
      document: row.document,
      seller: row.app_user,
      total: decimalToMoney(row.total) ?? '0.00',
      payment_type: isCash ? 'cash' : 'credit_settled',
      paid_at: row.last_payment_at ?? row.erp_created_at,
      // Null for cash: it was paid at the counter, so there is no collection
      // time to report. A 0 here would read as "pays instantly".
      payment_days: isCash
        ? null
        : daysBetween(row.erp_created_at, row.last_payment_at),
    };
  });

  return buildPage(items, total, query.page, query.limit);
};

/**
 * Credit and collections: outstanding invoices.
 *
 * erp_status = 2 AND pending_balance > 0, the complement of listCustomerSales.
 * Cash is excluded on top of that: it is born with a zero balance, so it never
 * reaches this list anyway, but the predicate documents the intent and guards
 * against a malformed import (CLAUDE.md 5.6). Matches the partial index
 * sale_pending_balance_idx.
 */
export const getCreditStatus = async (
  client: Client,
  id: string,
  pagination: PaginationQuery
): Promise<Paginated<CustomerCreditItem> & { totals: CustomerCreditTotals }> => {
  const where = {
    customer_id: id,
    deleted_at: null,
    pending_balance: { gt: 0 },
    erp_status: ERP_STATUS_SALE,
    // Spelled out rather than `NOT: { payment_id: 1 }`, which compiles to
    // NOT(payment_id = 1) — NULL for a null payment_id, so the row is dropped.
    // getCreditTotals keeps those rows, and the table would not add up to its
    // own total. payment_id is nullable even though the ERP always sends it.
    OR: [{ payment_id: { not: CASH_PAYMENT_ID } }, { payment_id: null }],
  };

  // Fetched first and outside the Promise.all below: this doubles as the
  // existence check, so a missing customer short-circuits before the two
  // sale queries run (mirrors the assertCustomerExists-first pattern used by
  // listCustomerSales, without paying for a second, redundant lookup).
  const customer = await client.customer.findFirst({
    where: { id, deleted_at: null },
    select: { credit_limit: true },
  });
  if (!customer) throw CustomError.notFound('Customer not found');

  const [rows, total] = await Promise.all([
    client.sale.findMany({
      where,
      select: {
        erp_sale_id: true,
        document: true,
        erp_created_at: true,
        total: true,
        pending_balance: true,
      },
      orderBy: { erp_created_at: 'asc' },
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
    }),
    client.sale.count({ where }),
  ]);

  const items: CustomerCreditItem[] = rows.map((row) => {
    const elapsed = daysSince(row.erp_created_at) ?? 0;
    const overdue = elapsed > CREDIT_TERM_DAYS;

    return {
      erp_sale_id: row.erp_sale_id,
      document: row.document,
      erp_created_at: row.erp_created_at,
      total: decimalToMoney(row.total) ?? '0.00',
      pending_balance: decimalToMoney(row.pending_balance) ?? '0.00',
      days_since_sale: elapsed,
      overdue,
      days_overdue: overdue ? elapsed - CREDIT_TERM_DAYS : 0,
    };
  });

  const totals = await getCreditTotals(client, id, customer.credit_limit);

  return { ...buildPage(items, total, pagination.page, pagination.limit), totals };
};

/** Guard used before the sub-resources, so a bad id answers 404 and not an empty page. */
export const assertCustomerExists = async (
  client: Client,
  id: string
): Promise<void> => {
  const found = await client.customer.findFirst({
    where: { id, deleted_at: null },
    select: { id: true },
  });

  if (!found) throw CustomError.notFound('Customer not found');
};

/**
 * RF-02: persist the customer's exact GPS for routing.
 *
 * Prisma cannot write Unsupported("geography"), so the repository goes
 * through $executeRaw. Re-reads via getCustomerCore so the response uses the same
 * lat/lng projection as the profile.
 */
export const updateCustomerLocation = async (
  client: Client,
  id: string,
  data: UpdateCustomerLocationInput
): Promise<CustomerCore> => {
  await assertCustomerExists(client, id);

  await setCustomerLocation(client, id, data.latitude, data.longitude);

  // address / place_id are plain columns — Prisma can write them. Only touch
  // when the client sent the field (omit = leave unchanged; null = clear).
  if (data.address !== undefined || data.place_id !== undefined) {
    await client.customer.update({
      where: { id },
      data: {
        ...(data.address !== undefined ? { address: data.address } : {}),
        ...(data.place_id !== undefined ? { place_id: data.place_id } : {}),
      },
    });
  }

  return getCustomerCore(client, id);
};

/**
 * Manual override for phone / trade_name: the Efactsoft import has no
 * per-customer source for either (see salesSync.service.ts upsertCustomer),
 * so this is the only path that can set them. Omit a field to leave it
 * unchanged, send null to clear it.
 */
export const updateCustomerContact = async (
  client: Client,
  id: string,
  data: UpdateCustomerContactInput
): Promise<CustomerCore> => {
  await assertCustomerExists(client, id);

  await client.customer.update({
    where: { id },
    data: {
      ...(data.phone !== undefined ? { phone: data.phone } : {}),
      ...(data.trade_name !== undefined ? { trade_name: data.trade_name } : {}),
      updated_at: new Date(),
    },
  });

  return getCustomerCore(client, id);
};

/*
 * ============================================================================
 * 2. OTHER METHODS — granular readers and mapping helpers that support the
 *    main methods above. getCustomerCore, getCustomerRoutes and
 *    getRecentVisitNotes are exported (not private) because the mobile stop
 *    screen (PCRM-46) reuses them to build its own, narrower projection.
 * ============================================================================
 */

/**
 * Customer identity and manual profile fields.
 *
 * Uses $queryRaw because `customer.location` is Unsupported("geography") in
 * Prisma and cannot appear in a typed select (repositories/customer.repository.ts).
 */
export const getCustomerCore = async (
  client: Client,
  id: string
): Promise<CustomerCore> => {
  const row = await findCustomerCore(client, id);
  if (!row) throw CustomError.notFound('Customer not found');

  return toCore(row);
};

/**
 * Routes the customer is part of — the "Rutas en las que aparece" line of the
 * profile header. A customer can belong to several routes, which is also why
 * there is no single owning seller.
 *
 * Not paginated: the whole system has only a handful of routes (CLAUDE.md
 * 7.9), so no customer can realistically belong to more than a few. The take
 * below is just a defensive cap against a data anomaly, not real pagination.
 */
export const getCustomerRoutes = async (
  client: Client,
  id: string,
  take = 20
): Promise<CustomerRouteRef[]> => {
  const rows = await client.route_customer.findMany({
    where: { customer_id: id, deleted_at: null, route: { deleted_at: null } },
    select: { route: { select: { id: true, name: true } } },
    orderBy: { route: { name: 'asc' } },
    take,
  });

  return rows.map((row) => row.route);
};

/** Latest field notes (RF-07) for the profile sidebar. */
export const getRecentVisitNotes = async (
  client: Client,
  id: string,
  take = 5
): Promise<CustomerVisitNote[]> => {
  const rows = await client.visit.findMany({
    where: {
      customer_id: id,
      deleted_at: null,
      notes: { not: null },
      started_at: { not: null },
    },
    select: { started_at: true, notes: true },
    orderBy: { started_at: 'desc' },
    take,
  });

  return rows.map((row) => ({
    date: row.started_at as Date,
    notes: row.notes as string,
  }));
};

/** KPI tiles of the profile Resumen tab, plus the derived category. */
export const getCustomerSummary = async (
  client: Client,
  id: string
): Promise<CustomerSummary & { category: CustomerCategory }> => {
  const [row, frequency] = await Promise.all([
    findCustomerSummary(client, id),
    findPurchaseFrequency(client, id),
  ]);

  if (!row) throw CustomError.notFound('Customer not found');

  return {
    category: row.category,
    net_purchases: row.net_purchases,
    orders_count: row.orders_count,
    visits_count: row.visits_count,
    conversion_rate: row.conversion_rate,
    avg_payment_days: row.avg_payment_days,
    pending_balance: row.pending_balance,
    purchase_frequency_days: frequency,
    last_purchase_at: row.last_purchase_at,
    last_visit_at: row.last_visit_at,
  };
};

/**
 * Portfolio totals for the credit tab. Computed over every outstanding invoice,
 * not just the current page.
 */
const getCreditTotals = async (
  client: Client,
  id: string,
  creditLimit: Prisma.Decimal | null
): Promise<CustomerCreditTotals> => {
  const row = (await findCreditTotals(client, id)) ?? {
    pending_balance: '0.00',
    overdue_amount: '0.00',
    overdue_count: 0,
  };

  const limit = decimalToMoney(creditLimit);
  const available =
    creditLimit === null
      ? null
      : creditLimit.minus(new Prisma.Decimal(row.pending_balance)).toFixed(2);

  return {
    pending_balance: row.pending_balance,
    overdue_amount: row.overdue_amount,
    overdue_count: row.overdue_count,
    credit_limit: limit,
    credit_available: available,
  };
};

const toCore = (row: CustomerCoreRow): CustomerCore => {
  const { lat, lng, ...rest } = row;
  return {
    ...rest,
    location: lat !== null && lng !== null ? { lat, lng } : null,
  };
};

const decimalToMoney = (value: Prisma.Decimal | null): string | null =>
  value === null ? null : value.toFixed(2);

/** Whole days elapsed between a date and now, floored at zero. */
const daysSince = (date: Date | null): number | null => {
  if (!date) return null;
  const diff = Date.now() - date.getTime();
  return Math.max(0, Math.floor(diff / 86_400_000));
};

/** Whole days between a sale and its collection. */
const daysBetween = (from: Date | null, to: Date | null): number | null => {
  if (!from || !to) return null;
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));
};
