import { Prisma } from '../../generated/prisma/client';
import { ERP_STATUS_SALE } from '../../domain/constants/businessRules';
import {
  ABC_CLASS_A_MAX_SHARE,
  ABC_CLASS_B_MAX_SHARE,
} from '../../domain/constants/productMetrics';
import { LocalDateRange } from '../../lib/localDateRange';
import { DateSpan, SALE_AT, inRange } from './fragments.sql';
import { productRankingSql } from './products.sql';

/*
 * Detail of a single product (PCRM-177). Every figure answers the same
 * definition of a confirmed sale as the rest of the panel — `sale.deleted_at
 * IS NULL`, `sale.erp_status = 2` and the line dated by `sale.erp_created_at`
 * (CLAUDE.md 5.5) — through SALE_AT / inRange / ERP_STATUS_SALE.
 */

/**
 * Limit handed to the ranking when it is reused as a window over the whole
 * catalog. The product table grows by hundreds of rows a year (CLAUDE.md 7.9),
 * so this is "every product" with room to spare; it exists only because
 * productRankingSql takes a LIMIT.
 */
const FULL_CATALOG_LIMIT = 1_000_000;

/**
 * Position, share and ABC class come from productRankingSql itself, embedded
 * here as a CTE: the ranking is never restated, so `position` is the same
 * order (amount DESC, product_id ASC) the ranking endpoint returns and
 * `period_total_amount` is the same total.
 *
 * `span` covers the selected period and the previous one, so the trend needs
 * no second scan: the lines of both periods are read once and split with
 * FILTER.
 *
 * The anchor of the query is `product`, not the sales: a product of the
 * catalog with no line in the range answers zeros, and only a product that
 * does not exist (or is deleted) returns no row at all, which the service
 * turns into a 404.
 */
export const productDetailSql = (
  range: LocalDateRange,
  previous: LocalDateRange,
  productId: number
): Prisma.Sql => {
  const span: DateSpan = { start: previous.start, end: range.end };

  return Prisma.sql`
    WITH ranked AS (
      ${productRankingSql(range, FULL_CATALOG_LIMIT)}
    ),
    period_total AS (
      -- Every ranked row carries the same total; MAX just picks it, and
      -- COALESCE covers a period with no sales at all.
      SELECT COALESCE(MAX(r.total_amount::numeric), 0) AS amount
      FROM   ranked r
    ),
    ranked_abc AS (
      -- Amount accumulated by the products ABOVE this one. The window runs
      -- over the whole ranking; the product is picked afterwards, in the JOIN.
      SELECT r.product_id,
             r.position,
             SUM(r.amount::numeric) OVER (ORDER BY r.position) - r.amount::numeric
               AS prior_amount
      FROM   ranked r
    ),
    lines AS (
      SELECT s.erp_sale_id,
             s.customer_id,
             COALESCE(d.total, 0)                            AS amount,
             COALESCE(d.quantity * COALESCE(d.factor, 1), 0) AS units,
             (${inRange(SALE_AT, range)})                    AS in_period
      FROM   sale_detail d
      JOIN   sale s
             ON s.erp_sale_id = d.erp_sale_id
      WHERE  d.product_id = ${productId}
        AND  s.deleted_at IS NULL
        AND  s.erp_status = ${ERP_STATUS_SALE}
        AND  ${inRange(SALE_AT, span)}
    ),
    agg AS (
      SELECT COALESCE(SUM(l.amount) FILTER (WHERE l.in_period), 0)      AS amount,
             COALESCE(SUM(l.units)  FILTER (WHERE l.in_period), 0)      AS units,
             COUNT(DISTINCT l.erp_sale_id) FILTER (WHERE l.in_period)   AS invoices,
             COUNT(DISTINCT l.customer_id) FILTER (WHERE l.in_period)   AS customers,
             COALESCE(SUM(l.amount) FILTER (WHERE NOT l.in_period), 0)  AS previous_amount
      FROM   lines l
    ),
    portfolio AS (
      -- The period's portfolio: every customer with at least one confirmed
      -- sale, company-wide. Penetration is read against this, not against a
      -- seller's route.
      SELECT COUNT(DISTINCT s.customer_id) AS customers
      FROM   sale s
      WHERE  s.deleted_at IS NULL
        AND  s.erp_status = ${ERP_STATUS_SALE}
        AND  s.customer_id IS NOT NULL
        AND  ${inRange(SALE_AT, range)}
    )
    SELECT p.erp_product_id::int                       AS product_id,
           p.code,
           p.name,
           p.product_group,
           a.position::int                             AS position,
           agg.amount::numeric(14,2)::text             AS amount,
           agg.units::numeric(16,4)::text              AS units,
           t.amount::numeric(14,2)::text               AS period_total_amount,
           COALESCE(ROUND(100.0 * agg.amount / NULLIF(t.amount, 0), 1), 0)::float8
             AS share_percent,
           agg.invoices::int                           AS invoices,
           COALESCE(agg.amount / NULLIF(agg.invoices, 0), 0)::numeric(14,2)::text
             AS average_ticket,
           agg.customers::int                          AS customers,
           portfolio.customers::int                    AS portfolio_customers,
           COALESCE(
             ROUND(100.0 * agg.customers / NULLIF(portfolio.customers, 0), 1), 0
           )::float8                                   AS penetration_percent,
           CASE
             WHEN a.product_id IS NULL OR t.amount = 0 THEN NULL
             WHEN a.prior_amount < t.amount * ${ABC_CLASS_A_MAX_SHARE} / 100.0 THEN 'A'
             WHEN a.prior_amount < t.amount * ${ABC_CLASS_B_MAX_SHARE} / 100.0 THEN 'B'
             ELSE 'C'
           END                                         AS abc_class,
           agg.previous_amount::numeric(14,2)::text    AS previous_amount,
           ROUND(
             100.0 * (agg.amount - agg.previous_amount)
             / NULLIF(agg.previous_amount, 0), 1
           )::float8                                   AS change_percent
    FROM   product p
    CROSS  JOIN agg
    CROSS  JOIN portfolio
    CROSS  JOIN period_total t
    LEFT   JOIN ranked_abc a
           ON a.product_id = p.erp_product_id
    WHERE  p.erp_product_id = ${productId}
      AND  p.deleted_at IS NULL
  `;
};

/**
 * Sellers who sold the product in the range, best first. A list, not a chart
 * aggregate: the panel shows who moves the product. Lines whose sale has no
 * `user_id` (an ERP user that never matched `app_user.erp_user_id`) have no
 * seller to credit and drop out; their amount still counts in the detail's
 * `amount`, so the two can differ. Disabled or deleted sellers stay: the sale
 * happened.
 */
export const productSellersSql = (
  range: LocalDateRange,
  productId: number
): Prisma.Sql => Prisma.sql`
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
  WHERE  d.product_id = ${productId}
    AND  s.deleted_at IS NULL
    AND  s.erp_status = ${ERP_STATUS_SALE}
    AND  ${inRange(SALE_AT, range)}
  GROUP  BY u.id, u.name
  ORDER  BY COALESCE(SUM(d.total), 0) DESC, u.name ASC
`;
