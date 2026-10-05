import { Prisma } from '../../generated/prisma/client';
import { ERP_STATUS_SALE } from '../../domain/constants/businessRules';
import { NO_MOVEMENT_WINDOWS_DAYS } from '../../domain/constants/productMetrics';
import { LocalDateRange } from '../../lib/localDateRange';
import { SALE_AT } from './fragments.sql';

/*
 * Products with no movement (PCRM-177). "Active product" is `deleted_at IS
 * NULL`: the catalog mirrors Efactsoft and has no sellable flag of its own
 * (prisma/schema.prisma, model product), so a row that is still there is a
 * row the ERP still sends.
 *
 * Same definition of a confirmed sale as the rest of the panel, read through
 * SALE_AT and ERP_STATUS_SALE.
 */

const MS_PER_DAY = 86_400_000;

/**
 * `days` before `instant`. El Salvador has no daylight saving (CLAUDE.md 5.7),
 * so a day is always 86 400 000 ms and this lands on the same local time of
 * day as `instant`.
 */
const daysBefore = (instant: Date, days: number): Date =>
  new Date(instant.getTime() - days * MS_PER_DAY);

/**
 * Last confirmed sale of every product, up to the end of the range. History
 * before the range is read on purpose: a product that has not sold in two
 * years must still report when it last did.
 */
const lastSaleCte = (range: LocalDateRange): Prisma.Sql => Prisma.sql`
  last_sale AS (
    SELECT d.product_id,
           MAX(${SALE_AT}) AS sold_at
    FROM   sale_detail d
    JOIN   sale s
           ON s.erp_sale_id = d.erp_sale_id
    WHERE  d.product_id IS NOT NULL
      AND  s.deleted_at IS NULL
      AND  s.erp_status = ${ERP_STATUS_SALE}
      AND  ${SALE_AT} < ${range.end}
    GROUP  BY d.product_id
  )
`;

/**
 * Active products with no confirmed sale inside the range. A product whose
 * last sale is older than `range.start`, or that never sold at all, is on the
 * list; `days_since_last_sale` counts to the end of the period, not to today,
 * so the figure does not drift with the clock.
 */
export const productsWithoutMovementSql = (range: LocalDateRange): Prisma.Sql => Prisma.sql`
  WITH ${lastSaleCte(range)}
  SELECT p.erp_product_id::int AS product_id,
         p.code,
         p.name,
         p.product_group,
         l.sold_at             AS last_sold_at,
         FLOOR(
           EXTRACT(EPOCH FROM (${range.end}::timestamptz - l.sold_at)) / 86400
         )::int                AS days_since_last_sale
  FROM   product p
  LEFT   JOIN last_sale l
         ON l.product_id = p.erp_product_id
  WHERE  p.deleted_at IS NULL
    AND  (l.sold_at IS NULL OR l.sold_at < ${range.start})
  ORDER  BY l.sold_at DESC NULLS LAST, p.name ASC
`;

/**
 * How many active products have no confirmed sale in the last 30, 60 and 90
 * days ending at the range's `to`. The windows do not depend on `from`: they
 * always hang from the end of the period, so a one-week range still answers
 * "and how many have been quiet for three months".
 */
export const productMovementCountsSql = (range: LocalDateRange): Prisma.Sql => {
  const [days30, days60, days90] = NO_MOVEMENT_WINDOWS_DAYS.map((days) =>
    daysBefore(range.end, days)
  );

  return Prisma.sql`
    WITH ${lastSaleCte(range)}
    SELECT COUNT(*)::int AS active_products,
           COUNT(*) FILTER (
             WHERE l.sold_at IS NULL OR l.sold_at < ${days30}
           )::int AS days_30,
           COUNT(*) FILTER (
             WHERE l.sold_at IS NULL OR l.sold_at < ${days60}
           )::int AS days_60,
           COUNT(*) FILTER (
             WHERE l.sold_at IS NULL OR l.sold_at < ${days90}
           )::int AS days_90
    FROM   product p
    LEFT   JOIN last_sale l
           ON l.product_id = p.erp_product_id
    WHERE  p.deleted_at IS NULL
  `;
};
