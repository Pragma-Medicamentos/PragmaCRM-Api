import { Prisma } from '../../generated/prisma/client';
import { ERP_STATUS_SALE } from '../../domain/constants/businessRules';
import { DateSpan } from '../metrics/fragments.sql';
import { ReportFilters, filterPredicates, reportSalesCtes } from './filters.sql';

/*
 * Customer lists of the management reports (PCRM-159): new, recovered and
 * without purchase. All three read confirmed sales only.
 */

/**
 * Clientes nuevos: customers whose FIRST confirmed sale ever falls inside the
 * range. A customer appears when it has a (filtered) sale in the range and no
 * confirmed sale at all before it, so a filter by seller or route keeps the
 * new customers that seller / route brought in.
 */
export const newCustomersSql = (span: DateSpan, filters: ReportFilters): Prisma.Sql => Prisma.sql`
  WITH ${reportSalesCtes(span, filters)},
  firsts AS (
    SELECT DISTINCT ON (rs.customer_id)
           rs.customer_id, rs.erp_created_at, rs.user_id, rs.route_name, rs.zone
    FROM   report_sales rs
    WHERE  rs.customer_id IS NOT NULL
    ORDER  BY rs.customer_id, rs.erp_created_at, rs.erp_sale_id
  ),
  totals AS (
    SELECT rs.customer_id,
           SUM(rs.amount) AS amount,
           COUNT(*)       AS orders_count
    FROM   report_sales rs
    WHERE  rs.customer_id IS NOT NULL
    GROUP  BY rs.customer_id
  )
  SELECT c.id::text                               AS customer_id,
         c.erp_customer_id::int                   AS erp_customer_id,
         c.name,
         c.trade_name,
         f.erp_created_at                         AS first_purchase_at,
         u.name                                   AS seller_name,
         f.route_name,
         f.zone,
         t.amount::numeric(14,2)::text            AS amount,
         t.orders_count::int                      AS orders_count
  FROM   firsts f
  JOIN   totals t
         ON t.customer_id = f.customer_id
  JOIN   customer c
         ON c.id = f.customer_id
  LEFT   JOIN app_user u
         ON u.id = f.user_id
  WHERE  NOT EXISTS (
           SELECT 1
           FROM   sale p
           WHERE  p.customer_id = f.customer_id
             AND  p.deleted_at IS NULL
             AND  p.erp_status = ${ERP_STATUS_SALE}
             AND  p.erp_created_at < ${span.start}
         )
  ORDER  BY f.erp_created_at, c.name
`;

/**
 * Clientes recuperados: customers with a (filtered) sale in the range that
 * came after more than `inactivityDays` without buying. Same rule as the
 * recovered_customers KPI (repositories/metrics/kpis/recovered_customers.sql.ts):
 * the gap is measured against the customer's previous confirmed sale, read
 * from all history; a first-ever sale has no gap and never counts.
 *
 * One row per customer: the first qualifying sale of the range.
 */
export const recoveredCustomersSql = (
  span: DateSpan,
  filters: ReportFilters,
  inactivityDays: number
): Prisma.Sql => Prisma.sql`
  WITH ${reportSalesCtes(span, filters)},
  history AS (
    SELECT s.erp_sale_id,
           LAG(s.erp_created_at) OVER (
             PARTITION BY s.customer_id ORDER BY s.erp_created_at, s.erp_sale_id
           ) AS previous_at
    FROM   sale s
    WHERE  s.deleted_at IS NULL
      AND  s.erp_status = ${ERP_STATUS_SALE}
      AND  s.customer_id IS NOT NULL
      AND  s.erp_created_at < ${span.end}
  ),
  qualifying AS (
    SELECT DISTINCT ON (rs.customer_id)
           rs.customer_id,
           rs.erp_created_at,
           h.previous_at,
           rs.user_id,
           rs.route_name,
           rs.amount
    FROM   report_sales rs
    JOIN   history h
           ON h.erp_sale_id = rs.erp_sale_id
    WHERE  rs.customer_id IS NOT NULL
      AND  h.previous_at IS NOT NULL
      AND  EXTRACT(EPOCH FROM (rs.erp_created_at - h.previous_at)) / 86400.0 > ${inactivityDays}
    ORDER  BY rs.customer_id, rs.erp_created_at, rs.erp_sale_id
  )
  SELECT c.id::text                         AS customer_id,
         c.erp_customer_id::int             AS erp_customer_id,
         c.name,
         c.trade_name,
         q.previous_at                      AS previous_purchase_at,
         q.erp_created_at                   AS recovered_at,
         FLOOR(EXTRACT(EPOCH FROM (q.erp_created_at - q.previous_at)) / 86400.0)::int
                                            AS days_inactive,
         u.name                             AS seller_name,
         q.route_name,
         q.amount::numeric(14,2)::text      AS amount
  FROM   qualifying q
  JOIN   customer c
         ON c.id = q.customer_id
  LEFT   JOIN app_user u
         ON u.id = q.user_id
  ORDER  BY q.erp_created_at, c.name
`;

/**
 * Clientes sin compra: active customers whose last confirmed sale, up to
 * `reference` (the end of the range, or now if the range reaches the future),
 * is more than 30 days old. Customers that never bought are out: there is no
 * last purchase to measure from.
 *
 * Route and zone filter by the customer's current routes (`route_customer`),
 * because the point of the list is customers that stopped buying, who often
 * have no recent attributed sale. The seller filter is the seller of the last
 * sale.
 */
export const customersWithoutPurchaseSql = (
  reference: Date,
  filters: ReportFilters
): Prisma.Sql => {
  const routeFilter =
    filters.routeId || filters.zone
      ? Prisma.sql`
          AND EXISTS (
            SELECT 1
            FROM   route_customer rc
            JOIN   route r
                   ON r.id = rc.route_id
                  AND r.deleted_at IS NULL
            WHERE  rc.customer_id = c.id
              AND  rc.deleted_at IS NULL
              ${filterPredicates(
                { routeId: filters.routeId, zone: filters.zone },
                {
                  userId: Prisma.raw('NULL'),
                  routeId: Prisma.raw('r.id'),
                  zone: Prisma.raw('r.zone'),
                }
              )}
          )`
      : Prisma.empty;
  const sellerFilter = filters.userId
    ? Prisma.sql`AND ls.user_id = ${filters.userId}::uuid`
    : Prisma.empty;

  return Prisma.sql`
    WITH last_sales AS (
      SELECT DISTINCT ON (s.customer_id)
             s.customer_id, s.erp_created_at, s.user_id, s.total
      FROM   sale s
      WHERE  s.deleted_at IS NULL
        AND  s.erp_status = ${ERP_STATUS_SALE}
        AND  s.customer_id IS NOT NULL
        AND  s.erp_created_at < ${reference}
      ORDER  BY s.customer_id, s.erp_created_at DESC, s.erp_sale_id DESC
    )
    SELECT c.id::text                     AS customer_id,
           c.erp_customer_id::int         AS erp_customer_id,
           c.name,
           c.trade_name,
           ls.erp_created_at              AS last_purchase_at,
           FLOOR(EXTRACT(EPOCH FROM (${reference}::timestamptz - ls.erp_created_at)) / 86400.0)::int
                                          AS days_without_purchase,
           ls.total::numeric(14,2)::text  AS last_amount,
           u.name                         AS seller_name,
           (SELECT string_agg(DISTINCT r.name, ', ' ORDER BY r.name)
            FROM   route_customer rc
            JOIN   route r
                   ON r.id = rc.route_id
                  AND r.deleted_at IS NULL
            WHERE  rc.customer_id = c.id
              AND  rc.deleted_at IS NULL) AS routes
    FROM   customer c
    JOIN   last_sales ls
           ON ls.customer_id = c.id
    LEFT   JOIN app_user u
           ON u.id = ls.user_id
    WHERE  c.deleted_at IS NULL
      AND  c.active
      AND  ls.erp_created_at < ${reference}::timestamptz - interval '30 days'
      ${sellerFilter}
      ${routeFilter}
    ORDER  BY ls.erp_created_at, c.name
  `;
};
