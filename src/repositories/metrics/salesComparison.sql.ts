import { Prisma } from '../../generated/prisma/client';
import { ERP_STATUS_SALE } from '../../domain/constants/businessRules';
import { SalesGroupBy } from '../../domain/schemas/salesComparison.schema';
import { KpiWindow, SALE_AT, inCurrent, inPrevious, inWindow } from './fragments.sql';

/*
 * Sales of the selected period against the previous one (PCRM-187), for the
 * whole company, one customer, one seller or both, optionally broken down by
 * customer or by seller.
 *
 * Same rules as the total_sales / orders_count / average_ticket KPIs, so the
 * unfiltered totals match those cards: confirmed sales only, VAT included,
 * dated by erp_created_at, [start, end) bounds from lib/localDateRange.ts.
 */

export interface SalesFilters {
  customerId?: string;
  userId?: string;
}

/** Confirmed sales of both periods that pass the filters, as CTE `filtered`. */
const filteredCte = (w: KpiWindow, filters: SalesFilters): Prisma.Sql => Prisma.sql`
  filtered AS (
    SELECT s.customer_id, s.user_id, s.total, s.erp_created_at
    FROM   sale s
    WHERE  s.deleted_at IS NULL
      AND  s.erp_status = ${ERP_STATUS_SALE}
      AND  ${inWindow(SALE_AT, w)}
      ${filters.customerId ? Prisma.sql`AND s.customer_id = ${filters.customerId}::uuid` : Prisma.empty}
      ${filters.userId ? Prisma.sql`AND s.user_id = ${filters.userId}::uuid` : Prisma.empty}
  )
`;

/**
 * The six raw aggregates of a group: each figure split by period with FILTER.
 * Money stays numeric here so the variation is computed before casting.
 */
const aggregates = (w: KpiWindow): Prisma.Sql => Prisma.sql`
  COALESCE(SUM(s.total) FILTER (WHERE ${inCurrent(SALE_AT, w)}), 0)::numeric(14,2)  AS cur_sales,
  COALESCE(SUM(s.total) FILTER (WHERE ${inPrevious(SALE_AT, w)}), 0)::numeric(14,2) AS prev_sales,
  COUNT(*) FILTER (WHERE ${inCurrent(SALE_AT, w)})::int                            AS cur_orders,
  COUNT(*) FILTER (WHERE ${inPrevious(SALE_AT, w)})::int                           AS prev_orders,
  (AVG(s.total) FILTER (WHERE ${inCurrent(SALE_AT, w)}))::numeric(14,2)            AS cur_ticket,
  (AVG(s.total) FILTER (WHERE ${inPrevious(SALE_AT, w)}))::numeric(14,2)           AS prev_ticket
`;

/** Percentage change rounded to one decimal; NULL without a base to divide by. */
const pct = (current: string, previous: string): Prisma.Sql =>
  Prisma.raw(
    `CASE WHEN ${previous} IS NULL OR ${previous} = 0 THEN NULL ` +
      `ELSE round((${current} - ${previous}) / ${previous} * 100, 1)::float8 END`
  );

/**
 * Projection over a row of `aggregates`: money as text (never a JS float),
 * counts as int, and the absolute and percentage change of each figure.
 */
const figures = Prisma.sql`
  a.cur_sales::text                              AS cur_sales,
  a.prev_sales::text                             AS prev_sales,
  (a.cur_sales - a.prev_sales)::text             AS diff_sales,
  ${pct('a.cur_sales', 'a.prev_sales')}          AS pct_sales,
  a.cur_orders,
  a.prev_orders,
  a.cur_orders - a.prev_orders                   AS diff_orders,
  ${pct('a.cur_orders::numeric', 'a.prev_orders::numeric')} AS pct_orders,
  a.cur_ticket::text                             AS cur_ticket,
  a.prev_ticket::text                            AS prev_ticket,
  (a.cur_ticket - a.prev_ticket)::text           AS diff_ticket,
  ${pct('a.cur_ticket', 'a.prev_ticket')}        AS pct_ticket
`;

/** One row: the totals of everything that passes the filters. */
export const salesComparisonTotalsSql = (w: KpiWindow, filters: SalesFilters): Prisma.Sql =>
  Prisma.sql`
    WITH ${filteredCte(w, filters)},
    agg AS (SELECT ${aggregates(w)} FROM filtered s)
    SELECT ${figures} FROM agg a
  `;

/** Grouping key and display name per `group_by`. LEFT JOIN keeps unmapped sales. */
const GROUPS: Record<SalesGroupBy, { key: Prisma.Sql; join: Prisma.Sql; name: Prisma.Sql }> = {
  customer: {
    key: Prisma.raw('s.customer_id'),
    join: Prisma.raw('LEFT JOIN customer g ON g.id = s.customer_id'),
    name: Prisma.raw('g.name'),
  },
  seller: {
    key: Prisma.raw('s.user_id'),
    join: Prisma.raw('LEFT JOIN app_user g ON g.id = s.user_id'),
    name: Prisma.raw('g.name'),
  },
};

/**
 * One row per customer or seller with sales in either period, biggest current
 * sales first, one page at a time. `total_count` is the number of groups.
 */
export const salesComparisonBreakdownSql = (
  w: KpiWindow,
  filters: SalesFilters,
  groupBy: SalesGroupBy,
  limit: number,
  offset: number
): Prisma.Sql => {
  const { key, join, name } = GROUPS[groupBy];

  return Prisma.sql`
    WITH ${filteredCte(w, filters)},
    agg AS (
      SELECT ${key}::text AS id, ${name} AS name, ${aggregates(w)}
      FROM   filtered s
      ${join}
      GROUP  BY ${key}, ${name}
    )
    SELECT a.id, a.name, ${figures}, COUNT(*) OVER()::int AS total_count
    FROM   agg a
    ORDER  BY a.cur_sales DESC, a.prev_sales DESC, a.name NULLS LAST, a.id
    LIMIT  ${limit} OFFSET ${offset}
  `;
};
