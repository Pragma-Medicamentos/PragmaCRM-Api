import { Prisma } from '../../generated/prisma/client';
import { ERP_STATUS_SALE } from '../../domain/constants/businessRules';
import { ROLES } from '../../domain/types/auth.types';
import { LocalDateRange, goalMonths } from '../../lib/localDateRange';
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
 * Goal slices (PCRM-173): a CTE named `name` with one row per seller and per
 * month the range touches in which the seller has a goal.
 *
 * - A `goal` row applies from its month onward, until a later row replaces
 *   it: the goal of month M is the latest row with (year, month) <= M. A
 *   goal of 0 means "no goal from that month on".
 * - The goal is prorated by the share of the month inside the range
 *   (`goalMonths`), so 7 days of October weigh 7/31 of October's goal.
 * - `sales` are the seller's confirmed sales inside that same slice, so a
 *   month without a goal never adds sales to the numerator.
 *
 * `name` must be a trusted constant: it is inlined as an identifier.
 */
export const goalSlicesCte = (range: LocalDateRange, name: string): Prisma.Sql => {
  const months = goalMonths(range).map(
    (m) => Prisma.sql`(${m.year}::int, ${m.month}::int, ${m.start}::timestamptz,
                       ${m.end}::timestamptz, ${m.factor}::numeric)`
  );

  return Prisma.sql`
    ${Prisma.raw(name)} AS (
      SELECT u.id                       AS user_id,
             u.active,
             eg.goal_amount * gm.factor AS goal_amount,
             COALESCE((SELECT SUM(s.total)
                       FROM   sale s
                       WHERE  s.deleted_at IS NULL
                         AND  s.erp_status = ${ERP_STATUS_SALE}
                         AND  s.user_id = u.id
                         AND  ${SALE_AT} >= gm.starts_at
                         AND  ${SALE_AT} <  gm.ends_at), 0) AS sales
      FROM   (VALUES ${Prisma.join(months)}) AS gm (year, month, starts_at, ends_at, factor)
      CROSS  JOIN app_user u
      CROSS  JOIN LATERAL (
               SELECT g.goal_amount
               FROM   goal g
               WHERE  g.user_id = u.id
                 AND  g.deleted_at IS NULL
                 AND  (g.year * 100 + g.month) <= gm.year * 100 + gm.month
               ORDER  BY g.year DESC, g.month DESC
               LIMIT  1
             ) eg
      WHERE  u.deleted_at IS NULL
        AND  u.role = ${ROLES.SELLER}
        AND  eg.goal_amount > 0
    )
  `;
};

/**
 * Consecutive-purchase gaps: a CTE (a named, temporary result that lives only
 * while the query runs) called `gaps`, with one row per confirmed sale up to
 * the end of the range and the days since the SAME customer's previous
 * confirmed sale.
 *
 *   LAG(erp_created_at) OVER (PARTITION BY customer_id ORDER BY erp_created_at)
 *   -> within each customer's sales, in date order, the date of the row before.
 *
 *   sale                      gaps
 *   A  10 Jun           ->    A  10 Jun  NULL   (first sale: nothing before)
 *   A  20 Aug           ->    A  20 Aug    71   (20 Aug - 10 Jun)
 *   A   5 Sep           ->    A   5 Sep    16   (5 Sep - 20 Aug)
 *
 * It is the gap between two sales, not the time since the last sale until
 * today. History before the range is read on purpose: the first purchase of
 * the period needs its predecessor, even if it happened a year earlier. Used
 * by recovered_customers and purchase_frequency_days.
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
