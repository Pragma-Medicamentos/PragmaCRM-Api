import { Prisma } from '../../generated/prisma/client';
import {
  CASH_PAYMENT_ID,
  CREDIT_TERM_DAYS,
  ERP_STATUS_SALE,
} from '../../domain/constants/businessRules';
import {
  CATEGORY_THRESHOLD_A,
  CATEGORY_THRESHOLD_B,
  CATEGORY_WEIGHT_CONVERSION,
  CATEGORY_WEIGHT_NET_PURCHASES,
  CATEGORY_WEIGHT_PAYMENT_DAYS,
  CATEGORY_WINDOW_MONTHS,
} from '../../domain/constants/customerCategory';

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
export const customerMetricsCte = (): Prisma.Sql => Prisma.sql`
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
