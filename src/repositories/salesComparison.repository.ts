import { Client } from '../lib/prisma';
import { SalesGroupBy } from '../domain/schemas/salesComparison.schema';
import {
  SalesComparison,
  SalesComparisonRow,
} from '../domain/types/salesComparison.types';
import { KpiWindow } from './metrics/fragments.sql';
import {
  SalesFilters,
  salesComparisonBreakdownSql,
  salesComparisonTotalsSql,
} from './metrics/salesComparison.sql';

/*
 * Data access of the sales comparison (PCRM-187). The SQL text lives in
 * ./metrics/salesComparison.sql.ts; this file runs it and folds the flat
 * columns into current / previous / variation.
 */

/** The flat projection `figures` of salesComparison.sql.ts. */
interface FiguresRow {
  cur_sales: string;
  prev_sales: string;
  diff_sales: string;
  pct_sales: number | null;
  cur_orders: number;
  prev_orders: number;
  diff_orders: number;
  pct_orders: number | null;
  cur_ticket: string | null;
  prev_ticket: string | null;
  diff_ticket: string | null;
  pct_ticket: number | null;
}

interface BreakdownRow extends FiguresRow {
  id: string | null;
  name: string | null;
  total_count: number;
}

const toComparison = (row: FiguresRow): SalesComparison => ({
  current: {
    total_sales: row.cur_sales,
    orders_count: row.cur_orders,
    average_ticket: row.cur_ticket,
  },
  previous: {
    total_sales: row.prev_sales,
    orders_count: row.prev_orders,
    average_ticket: row.prev_ticket,
  },
  variation: {
    total_sales: { amount: row.diff_sales, pct: row.pct_sales },
    orders_count: { amount: row.diff_orders, pct: row.pct_orders },
    average_ticket: { amount: row.diff_ticket, pct: row.pct_ticket },
  },
});

/** Always one row: an aggregate without GROUP BY answers zeros, not nothing. */
export const findSalesComparisonTotals = async (
  client: Client,
  window: KpiWindow,
  filters: SalesFilters
): Promise<SalesComparison> => {
  const rows = await client.$queryRaw<FiguresRow[]>(
    salesComparisonTotalsSql(window, filters)
  );
  return toComparison(rows[0]);
};

export const findSalesComparisonBreakdown = async (
  client: Client,
  window: KpiWindow,
  filters: SalesFilters,
  groupBy: SalesGroupBy,
  limit: number,
  offset: number
): Promise<{ items: SalesComparisonRow[]; total: number }> => {
  const rows = await client.$queryRaw<BreakdownRow[]>(
    salesComparisonBreakdownSql(window, filters, groupBy, limit, offset)
  );

  return {
    items: rows.map((row) => ({ id: row.id, name: row.name, ...toComparison(row) })),
    total: rows[0]?.total_count ?? 0,
  };
};
