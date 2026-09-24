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

/** Confirmed, non-deleted sales invoiced inside the range. Alias `s`. */
export const salesInRange = (range: LocalDateRange): Prisma.Sql => Prisma.sql`
  s.deleted_at IS NULL
  AND s.erp_status = ${ERP_STATUS_SALE}
  AND s.erp_created_at >= ${range.start}
  AND s.erp_created_at <  ${range.end}
`;

/** Non-deleted visits started inside the range. Alias `v`. */
export const visitsInRange = (range: LocalDateRange): Prisma.Sql => Prisma.sql`
  v.deleted_at IS NULL
  AND v.started_at >= ${range.start}
  AND v.started_at <  ${range.end}
`;

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
export const saleGapsCte = (range: LocalDateRange): Prisma.Sql => Prisma.sql`
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
