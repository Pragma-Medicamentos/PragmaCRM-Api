import { Prisma } from '../../generated/prisma/client';
import { ERP_STATUS_SALE } from '../../domain/constants/businessRules';
import { LocalDateRange, monthsTouched } from '../../lib/localDateRange';
import { ERP_TIMEZONE } from '../../lib/parseErpDate';

/*
 * SQL fragments shared by the metrics queries. Every filter is a [start, end)
 * predicate on the raw timestamptz column, with bounds computed in
 * lib/localDateRange.ts (CLAUDE.md 5.7): no `::date` in a WHERE.
 */

// SQL literal of the customer's timezone, for bucketing expressions. It comes
// from BUSINESS_TIMEZONE, which envs.ts validates against the IANA database at
// boot, never from a request, so inlining it is safe; it also keeps the same
// expression textually identical in SELECT and GROUP BY.
export const TZ = Prisma.raw(`'${ERP_TIMEZONE}'`);

/** The only part of a range a SQL filter needs: [start, end) instants. */
export type DateSpan = Pick<LocalDateRange, 'start' | 'end'>;

/**
 * What every per-KPI query receives. `range` is the selected period and
 * `previous` the period of equal length right before it; they are
 * contiguous (previous.end === range.start).
 */
export interface KpiWindow {
  range: LocalDateRange;
  previous: LocalDateRange;
  inactivityDays: number;
  now: Date;
}

/** Both periods as one span: from the previous period's start to the selected end. */
const spanOf = (window: KpiWindow): DateSpan => ({
  start: window.previous.start,
  end: window.range.end,
});

/*
 * Date predicates. One set for every table: pass the date column of the
 * table being filtered (VISIT_AT, SALE_AT, PROSPECT_AT...). Table rules such
 * as `deleted_at IS NULL` or `erp_status = 2` stay written in each query, next
 * to its FROM, so a reader sees them without opening this file.
 *
 * Every KPI query uses them in two layers:
 *   WHERE  inWindow   -> keeps the rows of BOTH periods, drops the rest
 *   FILTER inCurrent  -> of those, the selected period  -> value
 *   FILTER inPrevious -> of those, the previous period  -> previous_value
 */

/** Date columns, as trusted SQL references for the predicates below. */
export const VISIT_AT = Prisma.raw('v.started_at');
export const SALE_AT = Prisma.raw('s.erp_created_at');
export const PROSPECT_AT = Prisma.raw('p.created_at');

/** `column` inside [start, end). For queries over a single range. */
export const inRange = (column: Prisma.Sql, range: DateSpan): Prisma.Sql =>
  Prisma.sql`${column} >= ${range.start} AND ${column} < ${range.end}`;

/** `column` inside both periods of the window. The WHERE of every KPI. */
export const inWindow = (column: Prisma.Sql, window: KpiWindow): Prisma.Sql =>
  inRange(column, spanOf(window));

/** `column` in the selected period (from the cut on). FILTER for `value`. */
export const inCurrent = (column: Prisma.Sql, window: KpiWindow): Prisma.Sql =>
  Prisma.sql`${column} >= ${window.range.start}`;

/**
 * `column` in the previous period (before the cut). FILTER for
 * `previous_value`; no lower bound needed, inWindow already set it.
 */
export const inPrevious = (column: Prisma.Sql, window: KpiWindow): Prisma.Sql =>
  Prisma.sql`${column} < ${window.range.start}`;

/**
 * Goal rows (alias `g`) of the months the range touches. Goals are monthly:
 * a range of half a month is compared against the full month's goal.
 */
export const goalsOfMonths = (range: LocalDateRange): Prisma.Sql => {
  const keys = monthsTouched(range).map(({ year, month }) => year * 100 + month);

  return Prisma.sql`
    g.deleted_at IS NULL
    AND (g.year * 100 + g.month) IN (${Prisma.join(keys)})
  `;
};

/**
 * Goals of the months the range touches, summed per seller. Goals are
 * monthly: a range of half a month is compared against the full month's goal.
 */
export const goalsCte = (range: LocalDateRange): Prisma.Sql => {
  const keys = monthsTouched(range).map(({ year, month }) => year * 100 + month);

  return Prisma.sql`
    goals AS (
      SELECT g.user_id, SUM(g.goal_amount) AS goal_amount
      FROM   goal g
      WHERE  g.deleted_at IS NULL
        AND  (g.year * 100 + g.month) IN (${Prisma.join(keys)})
      GROUP  BY g.user_id
    )
  `;
};

/**
 * Consecutive-purchase gaps. For every confirmed sale up to the end of the
 * range, the days since the same customer's previous confirmed sale. History
 * before the range is read on purpose: the first purchase of the period needs
 * its predecessor, even if it happened a year earlier.
 */
export const saleGapsCte = (range: DateSpan): Prisma.Sql => Prisma.sql`
  gaps AS (
    SELECT s.customer_id,
           s.erp_created_at,
           EXTRACT(EPOCH FROM (
             s.erp_created_at
             - LAG(s.erp_created_at) OVER (
                 PARTITION BY s.customer_id ORDER BY s.erp_created_at
               )
           )) / 86400.0 AS gap_days
    FROM   sale s
    WHERE  s.deleted_at IS NULL
      AND  s.erp_status = ${ERP_STATUS_SALE}
      AND  s.customer_id IS NOT NULL
      AND  s.erp_created_at < ${range.end}
  )
`;
