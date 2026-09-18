import { Prisma } from '../generated/prisma/client';
import { Client } from '../lib/prisma';
import { CustomError } from '../domain/errors/CustomError';
import {
  CustomerCategory,
  ListCustomerSalesQuery,
  ListCustomersQuery,
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

// --- Business constants -----------------------------------------------------
//
// None of these live in the database. They change the result of several
// indicators at once, so they belong in the technical manual as well.
// See docs/Contexto_KPIs_Pragma_CRM.md sections 2 and 5.3, and CLAUDE.md 5.6/5.8.

/**
 * ERP sale states. 1 is an unprocessed quote, 2 is a confirmed sale.
 *
 * Quotes are out of scope as of 13 Sep: they are still landed in sale_staging
 * (the importer does not filter by state) but no endpoint exposes them and no
 * aggregate ever counted them.
 */
const ERP_STATUS_SALE = 2;

/**
 * Cash sales, excluded from collections and from the payment-days input:
 * they are born with a zero balance and would read as instant payers.
 *
 * Measured against the real ERP export: `id_pago` only ever takes 1 (Contado),
 * 5 (Crédito) and 6 (Crédito Pagado). This closes open decision D-9, which
 * assumed the criterion had to be parsed out of free text.
 */
const CASH_PAYMENT_ID = 1;

/** Uniform credit term for every customer. Client decision, CLAUDE.md 5.6. */
const CREDIT_TERM_DAYS = 60;

/**
 * Evaluation window of the A/B/C category. Open decision D-5: no document
 * fixes it, so 12 months is our documented assumption.
 */
const CATEGORY_WINDOW_MONTHS = 12;

/**
 * Weighted scoring of the A/B/C category, per the guide's recommended option.
 * Weights and cutoffs are a proposal, not an agreement (D-4/D-6): they need
 * the PO's and the client's sign-off.
 */
const CATEGORY_WEIGHT_NET_PURCHASES = 0.5;
const CATEGORY_WEIGHT_CONVERSION = 0.3;
const CATEGORY_WEIGHT_PAYMENT_DAYS = 0.2;
const CATEGORY_THRESHOLD_A = 70;
const CATEGORY_THRESHOLD_B = 40;

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
  const conditions: Prisma.Sql[] = [Prisma.sql`c.deleted_at IS NULL`];

  if (query.search) {
    const pattern = `%${query.search}%`;
    conditions.push(Prisma.sql`(
      c.name ILIKE ${pattern}
      OR c.trade_name ILIKE ${pattern}
      OR c.attends ILIKE ${pattern}
    )`);
  }

  if (query.zone) {
    conditions.push(Prisma.sql`c.zone = ${query.zone}`);
  }

  if (query.establishment_type) {
    conditions.push(
      Prisma.sql`c.establishment_type = ${query.establishment_type}`
    );
  }

  if (query.category) {
    conditions.push(Prisma.sql`m.category = ${query.category}`);
  }

  if (query.active !== undefined) {
    conditions.push(Prisma.sql`c.active = ${query.active}`);
  }

  if (query.without_gps !== undefined) {
    conditions.push(
      query.without_gps
        ? Prisma.sql`c.location IS NULL`
        : Prisma.sql`c.location IS NOT NULL`
    );
  }

  const where = Prisma.join(conditions, ' AND ');
  const offset = (query.page - 1) * query.limit;

  const rows = await client.$queryRaw<CustomerListRow[]>(
    customerListSql(where, query.limit, offset)
  );

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
 * Prisma cannot write Unsupported("geography"), so this goes through
 * $executeRaw. Re-reads via getCustomerCore so the response uses the same
 * lat/lng projection as the profile.
 */
export const updateCustomerLocation = async (
  client: Client,
  id: string,
  data: UpdateCustomerLocationInput
): Promise<CustomerCore> => {
  await assertCustomerExists(client, id);

  await client.$executeRaw`
    UPDATE customer
    SET
      location = extensions.ST_SetSRID(
        extensions.ST_MakePoint(${data.longitude}, ${data.latitude}),
        4326
      )::extensions.geography,
      updated_at = now()
    WHERE id = ${id}::uuid AND deleted_at IS NULL
  `;

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
 * Prisma and cannot appear in a typed select. PostGIS lives in the
 * `extensions` schema, hence the qualified calls in customerCoreSql.
 */
export const getCustomerCore = async (
  client: Client,
  id: string
): Promise<CustomerCore> => {
  const rows = await client.$queryRaw<CustomerCoreRow[]>(customerCoreSql(id));

  const row = rows[0];
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
  const [rows, frequency] = await Promise.all([
    client.$queryRaw<CustomerSummaryRow[]>(customerSummarySql(id)),
    getPurchaseFrequency(client, id),
  ]);

  const row = rows[0];
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

/** Average days between consecutive purchases. Null with fewer than two. */
const getPurchaseFrequency = async (
  client: Client,
  id: string
): Promise<number | null> => {
  const rows = await client.$queryRaw<{ frequency: number | null }[]>(
    purchaseFrequencySql(id)
  );

  return rows[0]?.frequency ?? null;
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
  const rows = await client.$queryRaw<
    { pending_balance: string; overdue_amount: string; overdue_count: number }[]
  >(creditTotalsSql(id));

  const row = rows[0] ?? {
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

/*
 * ============================================================================
 * 3. RAW SQL — every $queryRaw template this service runs, grouped here so
 *    the queries are auditable in one place instead of scattered inside the
 *    methods that call them. Each function returns a Prisma.Sql; the methods
 *    above only decide *when* to run it and how to shape the result.
 * ============================================================================
 */

/** Row of `metrics` selected by listCustomers, one per page of the customer list. */
interface CustomerListRow {
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
interface CustomerSummaryRow {
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
interface CustomerCoreRow {
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

/**
 * Per-customer commercial metrics and the derived A/B/C category.
 *
 * There is no `customer.category` column and none is wanted: the value is
 * derived, and a materialised view would have to be refreshed on every upload
 * and every closed visit. With 352 customers this aggregation is cheap.
 *
 * The net-purchases percentile is computed over the WHOLE portfolio, before
 * any filter. Narrowing by zone first would change every customer's letter.
 *
 * Shared by customerListSql and customerSummarySql, which each open with
 * `WITH ${customerMetricsCte()}` and select from the `metrics` relation it
 * produces.
 */
const customerMetricsCte = (): Prisma.Sql => Prisma.sql`
  win AS (
    SELECT (now() - make_interval(months => ${CATEGORY_WINDOW_MONTHS}))
             AS from_date
  ),
  net AS (
    SELECT s.customer_id,
           SUM(s.net_total)      AS net_purchases,
           COUNT(*)              AS orders_count,
           MAX(s.erp_created_at) AS last_purchase_at
    FROM   sale s CROSS JOIN win
    WHERE  s.deleted_at IS NULL
      AND  s.erp_status = ${ERP_STATUS_SALE}
      AND  s.customer_id IS NOT NULL
      AND  s.erp_created_at >= win.from_date
    GROUP  BY s.customer_id
  ),
  conv AS (
    -- Numerator is the linked sale, not visit.successful: the FK is
    -- contrastable against invoicing, the flag is self-declared by the seller.
    -- Denominator counts only 'visit' stops: a dispatch or a collection never
    -- produces a new sale and would unfairly inflate it.
    SELECT v.customer_id,
           COUNT(*)             AS visits_count,
           COUNT(s.erp_sale_id) AS converted_count
    FROM   visit v
    CROSS  JOIN win
    LEFT   JOIN sale s
           ON s.visit_id = v.id
          AND s.deleted_at IS NULL
          AND s.erp_status = ${ERP_STATUS_SALE}
    WHERE  v.deleted_at IS NULL
      AND  v.visit_type = 'visit'
      AND  v.started_at >= win.from_date
    GROUP  BY v.customer_id
  ),
  pay AS (
    SELECT s.customer_id,
           AVG(EXTRACT(EPOCH FROM (s.last_payment_at - s.erp_created_at))
               / 86400.0) AS avg_payment_days
    FROM   sale s CROSS JOIN win
    WHERE  s.deleted_at IS NULL
      AND  s.erp_status = ${ERP_STATUS_SALE}
      AND  s.pending_balance = 0
      AND  s.last_payment_at IS NOT NULL
      AND  s.erp_created_at IS NOT NULL
      AND  (s.payment_id IS NULL OR s.payment_id <> ${CASH_PAYMENT_ID})
      AND  s.erp_created_at >= win.from_date
    GROUP  BY s.customer_id
  ),
  bal AS (
    -- Matches the partial index sale_pending_balance_idx. Not limited to the
    -- window: an outstanding balance is outstanding regardless of its age.
    SELECT s.customer_id, SUM(s.pending_balance) AS pending_balance
    FROM   sale s
    WHERE  s.deleted_at IS NULL
      AND  s.pending_balance > 0
    GROUP  BY s.customer_id
  ),
  lastv AS (
    SELECT v.customer_id, MAX(v.started_at) AS last_visit_at
    FROM   visit v
    WHERE  v.deleted_at IS NULL
    GROUP  BY v.customer_id
  ),
  base AS (
    SELECT c.id,
           COALESCE(net.net_purchases, 0)    AS net_purchases,
           COALESCE(net.orders_count, 0)     AS orders_count,
           net.last_purchase_at,
           COALESCE(conv.visits_count, 0)    AS visits_count,
           COALESCE(conv.converted_count, 0) AS converted_count,
           pay.avg_payment_days,
           COALESCE(bal.pending_balance, 0)  AS pending_balance,
           lastv.last_visit_at
    FROM   customer c
    LEFT   JOIN net   ON net.customer_id   = c.id
    LEFT   JOIN conv  ON conv.customer_id  = c.id
    LEFT   JOIN pay   ON pay.customer_id   = c.id
    LEFT   JOIN bal   ON bal.customer_id   = c.id
    LEFT   JOIN lastv ON lastv.customer_id = c.id
    WHERE  c.deleted_at IS NULL
  ),
  scored AS (
    SELECT b.*,
           CASE WHEN b.visits_count = 0 THEN 0
                ELSE ROUND(100.0 * b.converted_count / b.visits_count)
           END AS conversion_rate,
           CASE WHEN b.orders_count = 0 THEN 0
                ELSE PERCENT_RANK() OVER (
                       PARTITION BY (b.orders_count > 0)
                       ORDER BY b.net_purchases
                     ) * 100
           END AS net_percentile,
           SUM(b.converted_count) OVER () AS portfolio_converted
    FROM   base b
  ),
  rated AS (
    SELECT s.*,
           ${CATEGORY_WEIGHT_NET_PURCHASES}::numeric * s.net_percentile
         + ${CATEGORY_WEIGHT_CONVERSION}::numeric    * s.conversion_rate
         + ${CATEGORY_WEIGHT_PAYMENT_DAYS}::numeric
           * (100 - LEAST(s.avg_payment_days, ${CREDIT_TERM_DAYS})
                    / ${CREDIT_TERM_DAYS}::numeric * 100) AS score
    FROM   scored s
  ),
  metrics AS (
    SELECT r.*,
           CASE
             -- No sales in the window: nothing to grade.
             WHEN r.orders_count = 0 THEN 'uncategorized'
             -- No settled credit invoice: input 3 cannot be computed.
             WHEN r.avg_payment_days IS NULL THEN 'uncategorized'
             -- Launch guard: while the importer does not stamp sale.visit_id,
             -- conversion is 0 for everyone and 30% of the score is dead
             -- weight, which would drag the whole portfolio down to C.
             WHEN r.portfolio_converted = 0 THEN 'uncategorized'
             WHEN r.score >= ${CATEGORY_THRESHOLD_A} THEN 'A'
             WHEN r.score >= ${CATEGORY_THRESHOLD_B} THEN 'B'
             ELSE 'C'
           END AS category
    FROM   rated r
  )
`;

/** SQL for getCustomerCore: identity fields plus PostGIS lat/lng. */
const customerCoreSql = (id: string): Prisma.Sql => Prisma.sql`
  SELECT c.id::text                AS id,
         c.erp_customer_id,
         c.name,
         c.trade_name,
         c.establishment_type,
         c.address,
         c.municipality,
         c.zone,
         c.phone,
         c.mobile,
         c.attends,
         c.personality,
         c.potential,
         c.credit,
         c.credit_limit::text      AS credit_limit,
         c.origin,
         c.active,
         extensions.st_y(c.location::extensions.geometry)::float8 AS lat,
         extensions.st_x(c.location::extensions.geometry)::float8 AS lng
  FROM   customer c
  WHERE  c.id = ${id}::uuid
    AND  c.deleted_at IS NULL
`;

/** SQL for listCustomers: paginated list with the metrics CTE joined in. */
const customerListSql = (
  where: Prisma.Sql,
  limit: number,
  offset: number
): Prisma.Sql => Prisma.sql`
  WITH ${customerMetricsCte()}
  SELECT c.id::text             AS id,
         c.erp_customer_id,
         c.name,
         c.trade_name,
         c.establishment_type,
         c.zone,
         c.municipality,
         c.attends,
         c.phone,
         c.active,
         (c.location IS NOT NULL) AS has_gps,
         m.category,
         m.net_purchases::text   AS net_purchases,
         m.orders_count::int     AS orders_count,
         m.visits_count::int     AS visits_count,
         m.conversion_rate::int  AS conversion_rate,
         ROUND(m.avg_payment_days)::int AS avg_payment_days,
         m.pending_balance::text AS pending_balance,
         COUNT(*) OVER ()::int   AS total_count
  FROM   customer c
  JOIN   metrics m ON m.id = c.id
  WHERE  ${where}
  ORDER  BY c.name ASC
  LIMIT  ${limit}
  OFFSET ${offset}
`;

/** SQL for getCustomerSummary: KPI tiles and category for a single customer. */
const customerSummarySql = (id: string): Prisma.Sql => Prisma.sql`
  WITH ${customerMetricsCte()}
  SELECT m.category,
         m.net_purchases::text     AS net_purchases,
         m.orders_count::int       AS orders_count,
         m.visits_count::int       AS visits_count,
         m.conversion_rate::int    AS conversion_rate,
         ROUND(m.avg_payment_days)::int AS avg_payment_days,
         m.pending_balance::text   AS pending_balance,
         m.last_purchase_at,
         m.last_visit_at
  FROM   metrics m
  WHERE  m.id = ${id}::uuid
`;

/** SQL for getPurchaseFrequency: average gap between consecutive purchases. */
const purchaseFrequencySql = (id: string): Prisma.Sql => Prisma.sql`
  SELECT ROUND(AVG(gap))::int AS frequency
  FROM (
    SELECT EXTRACT(EPOCH FROM (
             s.erp_created_at
             - LAG(s.erp_created_at) OVER (ORDER BY s.erp_created_at)
           )) / 86400.0 AS gap
    FROM   sale s
    WHERE  s.customer_id = ${id}::uuid
      AND  s.deleted_at IS NULL
      AND  s.erp_status = ${ERP_STATUS_SALE}
      AND  s.erp_created_at IS NOT NULL
  ) gaps
  WHERE gap IS NOT NULL
`;

/** SQL for getCreditTotals: portfolio totals for the credit tab. */
const creditTotalsSql = (id: string): Prisma.Sql => Prisma.sql`
  SELECT COALESCE(SUM(s.pending_balance), 0)::text AS pending_balance,
         COALESCE(SUM(s.pending_balance) FILTER (
           WHERE s.erp_created_at
                 < now() - make_interval(days => ${CREDIT_TERM_DAYS})
         ), 0)::text AS overdue_amount,
         COUNT(*) FILTER (
           WHERE s.erp_created_at
                 < now() - make_interval(days => ${CREDIT_TERM_DAYS})
         )::int AS overdue_count
  FROM   sale s
  WHERE  s.customer_id = ${id}::uuid
    AND  s.deleted_at IS NULL
    AND  s.pending_balance > 0
    AND  s.erp_status = ${ERP_STATUS_SALE}
    AND  (s.payment_id IS NULL OR s.payment_id <> ${CASH_PAYMENT_ID})
`;
