import { Prisma } from '../../generated/prisma/client';
import { CREDIT_TERM_DAYS } from '../../domain/constants/businessRules';
import { DateSpan } from '../metrics/fragments.sql';
import { ReportFilters, reportCreditSalesCtes } from './filters.sql';

/*
 * Credit reports of the management reports (PCRM-159): collections by seller
 * and the overdue portfolio. Both start from `report_credit_sales`, which
 * applies the same criterion as the overdue_portfolio / pending_collections
 * KPIs (confirmed sales, cash excluded), so with no filters their balances
 * add up to those KPIs.
 */

/**
 * Cobranza por vendedor.
 *
 * There is no payments table: Efactsoft only reports each invoice's current
 * balance, which every upload appends to `balance_snapshot` (a ledger, never
 * overwritten). What was collected is therefore read as the drops of an
 * invoice's balance between two consecutive snapshots: a drop recorded by an
 * upload whose `captured_at` falls inside `span` counts for the period. The
 * previous snapshot may be older than the range, which is why the LAG runs
 * over the whole history before filtering.
 *
 * Next to it, the balances as of today: pending and overdue (older than the
 * credit term), exactly as the KPIs compute them.
 */
export const collectionsBySellerSql = (
  span: DateSpan,
  now: Date,
  filters: ReportFilters
): Prisma.Sql => Prisma.sql`
  WITH ${reportCreditSalesCtes(now, filters)},
  deltas AS (
    SELECT cs.user_id,
           b.captured_at,
           GREATEST(
             LAG(b.pending_balance) OVER (
               PARTITION BY b.erp_sale_id ORDER BY b.captured_at, b.id
             ) - b.pending_balance,
             0
           ) AS collected
    FROM   balance_snapshot b
    JOIN   report_credit_sales cs
           ON cs.erp_sale_id = b.erp_sale_id
    WHERE  b.captured_at < ${span.end}
  ),
  collected AS (
    SELECT d.user_id,
           SUM(d.collected)                         AS amount,
           COUNT(*) FILTER (WHERE d.collected > 0)  AS payments
    FROM   deltas d
    WHERE  d.captured_at >= ${span.start}
    GROUP  BY d.user_id
  ),
  balances AS (
    SELECT cs.user_id,
           SUM(cs.pending_balance) FILTER (WHERE cs.pending_balance > 0) AS pending,
           SUM(cs.pending_balance) FILTER (
             WHERE cs.pending_balance > 0
               AND cs.erp_created_at < ${now}::timestamptz - make_interval(days => ${CREDIT_TERM_DAYS})
           ) AS overdue,
           COUNT(*) FILTER (WHERE cs.pending_balance > 0) AS pending_invoices
    FROM   report_credit_sales cs
    GROUP  BY cs.user_id
  )
  SELECT u.name                                               AS seller_name,
         COALESCE(c.amount, 0)::numeric(14,2)::text           AS collected,
         COALESCE(c.payments, 0)::int                         AS payments,
         COALESCE(b.pending, 0)::numeric(14,2)::text          AS pending,
         COALESCE(b.overdue, 0)::numeric(14,2)::text          AS overdue,
         COALESCE(b.pending_invoices, 0)::int                 AS pending_invoices
  FROM   balances b
  -- Sentinel uuid so invoices without a seller meet in one row (FULL JOIN
  -- does not take IS NOT DISTINCT FROM).
  FULL   OUTER JOIN collected c
         ON COALESCE(c.user_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = COALESCE(b.user_id, '00000000-0000-0000-0000-000000000000'::uuid)
  LEFT   JOIN app_user u
         ON u.id = COALESCE(b.user_id, c.user_id)
  WHERE  COALESCE(c.amount, 0) > 0 OR COALESCE(b.pending, 0) > 0
  ORDER  BY COALESCE(c.amount, 0) DESC, u.name NULLS LAST
`;

/**
 * Cartera vencida, one row per invoice, as of `now`: credit balance of
 * invoices older than the credit term. Same condition as the
 * overdue_portfolio KPI, so with no filters the balances add up to it.
 */
export const overduePortfolioSql = (now: Date, filters: ReportFilters): Prisma.Sql => Prisma.sql`
  WITH ${reportCreditSalesCtes(now, filters)}
  SELECT cs.erp_sale_id::int                       AS erp_sale_id,
         cs.document,
         c.erp_customer_id::int                    AS erp_customer_id,
         c.name                                    AS customer_name,
         c.trade_name,
         cs.erp_created_at                         AS issued_at,
         FLOOR(EXTRACT(EPOCH FROM (${now}::timestamptz - cs.erp_created_at)) / 86400.0)::int
           - ${CREDIT_TERM_DAYS}                   AS days_overdue,
         cs.total::numeric(14,2)::text             AS total,
         cs.pending_balance::numeric(14,2)::text   AS pending_balance,
         u.name                                    AS seller_name,
         cs.route_name,
         cs.zone
  FROM   report_credit_sales cs
  LEFT   JOIN customer c
         ON c.id = cs.customer_id
  LEFT   JOIN app_user u
         ON u.id = cs.user_id
  WHERE  cs.pending_balance > 0
    AND  cs.erp_created_at < ${now}::timestamptz - make_interval(days => ${CREDIT_TERM_DAYS})
  ORDER  BY cs.erp_created_at, cs.erp_sale_id
`;
