import { Prisma } from '../../generated/prisma/client';
import {
  CASH_PAYMENT_ID,
  CREDIT_TERM_DAYS,
  ERP_STATUS_SALE,
} from '../../domain/constants/businessRules';
import { ListCustomersQuery } from '../../domain/schemas/customer.schema';
import { customerMetricsCte } from './customerMetrics.cte';

/**
 * WHERE of the customer list (1n filters). `m` is the metrics relation, so
 * the category filter works on the derived letter, not on a column.
 */
export const customerListWhere = (query: ListCustomersQuery): Prisma.Sql => {
  const conditions: Prisma.Sql[] = [Prisma.sql`c.deleted_at IS NULL`];

  if (query.search) {
    const pattern = `%${query.search}%`;
    conditions.push(Prisma.sql`(
      c.name ILIKE ${pattern}
      OR c.trade_name ILIKE ${pattern}
      OR c.attends ILIKE ${pattern}
    )`);
  }

  if (query.zone) {
    conditions.push(Prisma.sql`c.zone = ${query.zone}`);
  }

  if (query.establishment_type) {
    conditions.push(
      Prisma.sql`c.establishment_type = ${query.establishment_type}`
    );
  }

  if (query.category) {
    conditions.push(Prisma.sql`m.category = ${query.category}`);
  }

  if (query.active !== undefined) {
    conditions.push(Prisma.sql`c.active = ${query.active}`);
  }

  if (query.without_gps !== undefined) {
    conditions.push(
      query.without_gps
        ? Prisma.sql`c.location IS NULL`
        : Prisma.sql`c.location IS NOT NULL`
    );
  }

  return Prisma.join(conditions, ' AND ');
};

/** SQL for getCustomerCore: identity fields plus PostGIS lat/lng. */
export const customerCoreSql = (id: string): Prisma.Sql => Prisma.sql`
  SELECT c.id::text                AS id,
         c.erp_customer_id,
         c.name,
         c.trade_name,
         c.establishment_type,
         c.address,
         c.place_id,
         c.municipality,
         c.zone,
         c.phone,
         c.mobile,
         c.attends,
         c.personality,
         c.potential,
         c.credit,
         c.credit_limit::text      AS credit_limit,
         c.origin,
         c.active,
         extensions.st_y(c.location::extensions.geometry)::float8 AS lat,
         extensions.st_x(c.location::extensions.geometry)::float8 AS lng
  FROM   customer c
  WHERE  c.id = ${id}::uuid
    AND  c.deleted_at IS NULL
`;

/** SQL for listCustomers: paginated list with the metrics CTE joined in. */
export const customerListSql = (
  where: Prisma.Sql,
  limit: number,
  offset: number
): Prisma.Sql => Prisma.sql`
  WITH ${customerMetricsCte()}
  SELECT c.id::text             AS id,
         c.erp_customer_id,
         c.name,
         c.trade_name,
         c.establishment_type,
         c.zone,
         c.municipality,
         c.attends,
         c.phone,
         c.active,
         (c.location IS NOT NULL) AS has_gps,
         m.category,
         m.net_purchases::text   AS net_purchases,
         m.orders_count::int     AS orders_count,
         m.visits_count::int     AS visits_count,
         m.conversion_rate::int  AS conversion_rate,
         ROUND(m.avg_payment_days)::int AS avg_payment_days,
         m.pending_balance::text AS pending_balance,
         COUNT(*) OVER ()::int   AS total_count
  FROM   customer c
  JOIN   metrics m ON m.id = c.id
  WHERE  ${where}
  ORDER  BY c.name ASC
  LIMIT  ${limit}
  OFFSET ${offset}
`;

/** SQL for getCustomerSummary: KPI tiles and category for a single customer. */
export const customerSummarySql = (id: string): Prisma.Sql => Prisma.sql`
  WITH ${customerMetricsCte()}
  SELECT m.category,
         m.net_purchases::text     AS net_purchases,
         m.orders_count::int       AS orders_count,
         m.visits_count::int       AS visits_count,
         m.conversion_rate::int    AS conversion_rate,
         ROUND(m.avg_payment_days)::int AS avg_payment_days,
         m.pending_balance::text   AS pending_balance,
         m.last_purchase_at,
         m.last_visit_at
  FROM   metrics m
  WHERE  m.id = ${id}::uuid
`;

/** SQL for getPurchaseFrequency: average gap between consecutive purchases. */
export const purchaseFrequencySql = (id: string): Prisma.Sql => Prisma.sql`
  SELECT ROUND(AVG(gap))::int AS frequency
  FROM (
    SELECT EXTRACT(EPOCH FROM (
             s.erp_created_at
             - LAG(s.erp_created_at) OVER (ORDER BY s.erp_created_at)
           )) / 86400.0 AS gap
    FROM   sale s
    WHERE  s.customer_id = ${id}::uuid
      AND  s.deleted_at IS NULL
      AND  s.erp_status = ${ERP_STATUS_SALE}
      AND  s.erp_created_at IS NOT NULL
  ) gaps
  WHERE gap IS NOT NULL
`;

/** SQL for getCreditTotals: portfolio totals for the credit tab. */
export const creditTotalsSql = (id: string): Prisma.Sql => Prisma.sql`
  SELECT COALESCE(SUM(s.pending_balance), 0)::text AS pending_balance,
         COALESCE(SUM(s.pending_balance) FILTER (
           WHERE s.erp_created_at
                 < now() - make_interval(days => ${CREDIT_TERM_DAYS})
         ), 0)::text AS overdue_amount,
         COUNT(*) FILTER (
           WHERE s.erp_created_at
                 < now() - make_interval(days => ${CREDIT_TERM_DAYS})
         )::int AS overdue_count
  FROM   sale s
  WHERE  s.customer_id = ${id}::uuid
    AND  s.deleted_at IS NULL
    AND  s.pending_balance > 0
    AND  s.erp_status = ${ERP_STATUS_SALE}
    AND  (s.payment_id IS NULL OR s.payment_id <> ${CASH_PAYMENT_ID})
`;

/** SQL for setCustomerLocation: WGS84 point, PostGIS in the `extensions` schema. */
export const setCustomerLocationSql = (
  id: string,
  latitude: number,
  longitude: number
): Prisma.Sql => Prisma.sql`
  UPDATE customer
  SET
    location = extensions.ST_SetSRID(
      extensions.ST_MakePoint(${longitude}, ${latitude}),
      4326
    )::extensions.geography,
    updated_at = now()
  WHERE id = ${id}::uuid AND deleted_at IS NULL
`;
