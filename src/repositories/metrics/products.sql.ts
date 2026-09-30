import { Prisma } from '../../generated/prisma/client';
import { ERP_STATUS_SALE } from '../../domain/constants/businessRules';
import { LocalDateRange } from '../../lib/localDateRange';
import { SALE_AT, inRange } from './fragments.sql';

/**
 * Products ranked by sold amount in the range (PCRM-172). Lines are credited
 * to the date of their sale (`sale.erp_created_at`, CLAUDE.md 5.5), not to
 * the line's own timestamps, so a product moves with the invoice it belongs
 * to. Confirmed sales only, VAT included (decision D-1), like total_sales.
 *
 * `total_amount` is a window over the whole ranking, evaluated before LIMIT,
 * so the page of top N still carries the period's full total. Orphan lines
 * (`product_id IS NULL`) and deleted products are out: they have no catalog
 * row to name.
 *
 * `quantity` is in each line's own unit of measure (a product sells by the
 * UNIDAD and by the DOCENA); `factor` converts it to the product's base unit,
 * so `units` adds like with like.
 */
export const productRankingSql = (
  range: LocalDateRange,
  limit: number
): Prisma.Sql => Prisma.sql`
  WITH sold AS (
    SELECT d.product_id,
           COALESCE(SUM(d.total), 0)    AS amount,
           COALESCE(SUM(d.quantity * COALESCE(d.factor, 1)), 0) AS units
    FROM   sale_detail d
    JOIN   sale s
           ON s.erp_sale_id = d.erp_sale_id
    WHERE  d.product_id IS NOT NULL
      AND  s.deleted_at IS NULL
      AND  s.erp_status = ${ERP_STATUS_SALE}
      AND  ${inRange(SALE_AT, range)}
    GROUP  BY d.product_id
  )
  SELECT ROW_NUMBER() OVER (ORDER BY sold.amount DESC, sold.product_id ASC)::int
           AS position,
         p.erp_product_id::int              AS product_id,
         p.code,
         p.name,
         sold.amount::numeric(14,2)::text   AS amount,
         sold.units::numeric(16,4)::text    AS units,
         SUM(sold.amount) OVER ()::numeric(14,2)::text AS total_amount
  FROM   sold
  JOIN   product p
         ON p.erp_product_id = sold.product_id
        AND p.deleted_at IS NULL
  ORDER  BY sold.amount DESC, sold.product_id ASC
  LIMIT  ${limit}
`;
