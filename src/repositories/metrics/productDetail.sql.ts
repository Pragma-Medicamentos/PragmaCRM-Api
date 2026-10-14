import { Prisma } from '../../generated/prisma/client';
import { ERP_STATUS_SALE } from '../../domain/constants/businessRules';
import { LocalDateRange } from '../../lib/localDateRange';
import { SALE_AT, inRange } from './fragments.sql';

/*
 * Detail of a single product (PCRM-177). Every figure answers the same
 * definition of a confirmed sale as the rest of the panel — `sale.deleted_at
 * IS NULL`, `sale.erp_status = 2` and the line dated by `sale.erp_created_at`
 * (CLAUDE.md 5.5) — through SALE_AT / inRange / ERP_STATUS_SALE.
 */

/** WHERE of the product's confirmed lines in the range, over `sale_detail d JOIN sale s`. */
const productLinesFilter = (range: LocalDateRange, productId: number): Prisma.Sql => Prisma.sql`
  d.product_id = ${productId}
  AND s.deleted_at IS NULL
  AND s.erp_status = ${ERP_STATUS_SALE}
  AND ${inRange(SALE_AT, range)}
`;

/**
 * The anchor of the query is `product`, not the sales: a product of the
 * catalog with no line in the range answers zeros, and only a product that
 * does not exist (or is deleted) returns no row at all, which the service
 * turns into a 404.
 */
export const productDetailSql = (range: LocalDateRange, productId: number): Prisma.Sql => Prisma.sql`
  WITH agg AS (
    SELECT COALESCE(SUM(d.total), 0)                            AS amount,
           COALESCE(SUM(d.quantity * COALESCE(d.factor, 1)), 0) AS units,
           COUNT(DISTINCT s.erp_sale_id)                        AS invoices
    FROM   sale_detail d
    JOIN   sale s
           ON s.erp_sale_id = d.erp_sale_id
    WHERE  ${productLinesFilter(range, productId)}
  )
  SELECT p.erp_product_id::int                AS product_id,
         p.code,
         p.name,
         p.product_group,
         agg.amount::numeric(14,2)::text      AS amount,
         agg.units::numeric(16,4)::text       AS units,
         COALESCE(agg.amount / NULLIF(agg.invoices, 0), 0)::numeric(14,2)::text
           AS average_ticket
  FROM   product p
  CROSS  JOIN agg
  WHERE  p.erp_product_id = ${productId}
    AND  p.deleted_at IS NULL
`;

/**
 * Sellers who sold the product in the range, best first. Lines whose sale has
 * no `user_id` (an ERP user that never matched `app_user.erp_user_id`) have no
 * seller to credit and drop out; their amount still counts in the detail's
 * `amount`, so the two can differ. Disabled or deleted sellers stay: the sale
 * happened.
 */
export const productSellersSql = (range: LocalDateRange, productId: number): Prisma.Sql => Prisma.sql`
  SELECT u.id::text                                          AS user_id,
         u.name,
         COALESCE(SUM(d.total), 0)::numeric(14,2)::text      AS amount,
         COALESCE(SUM(d.quantity * COALESCE(d.factor, 1)), 0)::numeric(16,4)::text
           AS units
  FROM   sale_detail d
  JOIN   sale s
         ON s.erp_sale_id = d.erp_sale_id
  JOIN   app_user u
         ON u.id = s.user_id
  WHERE  ${productLinesFilter(range, productId)}
  GROUP  BY u.id, u.name
  ORDER  BY COALESCE(SUM(d.total), 0) DESC, u.name ASC
`;

/**
 * One page of the customers who bought the product in the range, biggest
 * buyer first. Same rule as the sellers: a sale without `customer_id` has
 * nobody to list, and deleted customers stay because the sale happened.
 */
export const productCustomersSql = (
  range: LocalDateRange,
  productId: number,
  limit: number,
  offset: number
): Prisma.Sql => Prisma.sql`
  SELECT c.id::text                                          AS customer_id,
         c.name,
         c.trade_name,
         COALESCE(SUM(d.total), 0)::numeric(14,2)::text      AS amount,
         COALESCE(SUM(d.quantity * COALESCE(d.factor, 1)), 0)::numeric(16,4)::text
           AS units,
         COUNT(DISTINCT s.erp_sale_id)::int                  AS invoices,
         MAX(s.erp_created_at)                               AS last_purchase_at
  FROM   sale_detail d
  JOIN   sale s
         ON s.erp_sale_id = d.erp_sale_id
  JOIN   customer c
         ON c.id = s.customer_id
  WHERE  ${productLinesFilter(range, productId)}
  GROUP  BY c.id, c.name, c.trade_name
  ORDER  BY COALESCE(SUM(d.total), 0) DESC, c.name ASC, c.id ASC
  LIMIT  ${limit}
  OFFSET ${offset}
`;

/**
 * Whether the product exists and how many customers bought it: the 404 and
 * the paging total in one round trip, so a page past the end still knows the
 * total.
 */
export const productCustomersTotalSql = (
  range: LocalDateRange,
  productId: number
): Prisma.Sql => Prisma.sql`
  SELECT EXISTS (
           SELECT 1
           FROM   product p
           WHERE  p.erp_product_id = ${productId}
             AND  p.deleted_at IS NULL
         )                                                   AS product_exists,
         (
           SELECT COUNT(DISTINCT s.customer_id)
           FROM   sale_detail d
           JOIN   sale s
                  ON s.erp_sale_id = d.erp_sale_id
           WHERE  ${productLinesFilter(range, productId)}
         )::int                                              AS total
`;
