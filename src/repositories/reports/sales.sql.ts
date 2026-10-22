import { Prisma } from '../../generated/prisma/client';
import { SalesReportGroup } from '../../domain/schemas/report.schema';
import { DateSpan } from '../metrics/fragments.sql';
import { ReportFilters, reportSalesCtes } from './filters.sql';

/*
 * Sales of the management reports (PCRM-159), grouped by one dimension.
 * Feeds GET /reports/sales/:group, the ABC report and the rankings.
 *
 * Every group but `product` adds up `report_sales` (whole invoices, VAT
 * included, like total_sales). `product` adds up invoice lines, like the
 * product ranking (repositories/metrics/products.sql.ts): units in the
 * product's base unit (quantity x factor).
 *
 * Rows whose dimension is unknown (a sale without a seller, without an
 * attributed route...) are kept under key NULL, so the groups add up to the
 * filtered total and the builder can label them ("Sin ruta atribuible").
 */

interface GroupSql {
  /** Key column of the group (text). */
  key: string;
  /** Display name. */
  label: string;
  /** Secondary text: trade name, ERP code. */
  detail: string;
  joins: string;
}

const INVOICE_GROUPS: Record<Exclude<SalesReportGroup, 'product'>, GroupSql> = {
  seller: {
    key: 'rs.user_id::text',
    label: 'u.name',
    detail: 'NULL::text',
    joins: 'LEFT JOIN app_user u ON u.id = rs.user_id',
  },
  customer: {
    key: 'rs.customer_id::text',
    label: 'c.name',
    detail: 'c.trade_name',
    joins: 'LEFT JOIN customer c ON c.id = rs.customer_id',
  },
  route: {
    key: 'rs.route_id::text',
    label: 'rs.route_name',
    detail: 'rs.zone',
    joins: '',
  },
  zone: {
    key: "NULLIF(btrim(rs.zone), '')",
    label: "NULLIF(btrim(rs.zone), '')",
    detail: 'NULL::text',
    joins: '',
  },
  municipality: {
    key: "NULLIF(btrim(rs.municipality), '')",
    label: "NULLIF(btrim(rs.municipality), '')",
    detail: 'NULL::text',
    joins: '',
  },
};

const invoiceGroupSql = (span: DateSpan, filters: ReportFilters, g: GroupSql): Prisma.Sql =>
  Prisma.sql`
    WITH ${reportSalesCtes(span, filters)}
    SELECT ${Prisma.raw(g.key)}                         AS key,
           MAX(${Prisma.raw(g.label)})                  AS label,
           MAX(${Prisma.raw(g.detail)})                 AS detail,
           COALESCE(SUM(rs.amount), 0)::numeric(14,2)::text AS amount,
           COUNT(*)::int                                AS orders_count,
           COUNT(DISTINCT rs.customer_id)::int          AS customers,
           NULL::text                                   AS units
    FROM   report_sales rs
    ${Prisma.raw(g.joins)}
    GROUP  BY 1
    ORDER  BY SUM(rs.amount) DESC NULLS LAST, 2 ASC
  `;

const productGroupSql = (span: DateSpan, filters: ReportFilters): Prisma.Sql => Prisma.sql`
  WITH ${reportSalesCtes(span, filters)}
  SELECT p.erp_product_id::text                            AS key,
         MAX(p.name)                                       AS label,
         MAX(p.code)                                       AS detail,
         COALESCE(SUM(d.total), 0)::numeric(14,2)::text    AS amount,
         COUNT(DISTINCT rs.erp_sale_id)::int               AS orders_count,
         COUNT(DISTINCT rs.customer_id)::int               AS customers,
         COALESCE(SUM(d.quantity * COALESCE(d.factor, 1)), 0)::numeric(16,4)::text AS units
  FROM   report_sales rs
  JOIN   sale_detail d
         ON d.erp_sale_id = rs.erp_sale_id
  JOIN   product p
         ON p.erp_product_id = d.product_id
        AND p.deleted_at IS NULL
  GROUP  BY p.erp_product_id
  ORDER  BY SUM(d.total) DESC NULLS LAST, p.erp_product_id ASC
`;

export const salesByGroupSql = (
  span: DateSpan,
  filters: ReportFilters,
  group: SalesReportGroup
): Prisma.Sql =>
  group === 'product'
    ? productGroupSql(span, filters)
    : invoiceGroupSql(span, filters, INVOICE_GROUPS[group]);

/**
 * Sales per seller in the selected period and in the previous one of equal
 * length (`previous.start` to `current.start`), for the sellers comparison.
 * `span` must cover both periods.
 */
export const sellersComparisonSql = (
  span: DateSpan,
  currentStart: Date,
  filters: ReportFilters
): Prisma.Sql => Prisma.sql`
  WITH ${reportSalesCtes(span, filters)}
  SELECT rs.user_id::text AS key,
         MAX(u.name)      AS label,
         COALESCE(SUM(rs.amount) FILTER (WHERE rs.erp_created_at >= ${currentStart}), 0)
           ::numeric(14,2)::text AS cur_amount,
         COUNT(*) FILTER (WHERE rs.erp_created_at >= ${currentStart})::int AS cur_orders,
         COALESCE(SUM(rs.amount) FILTER (WHERE rs.erp_created_at < ${currentStart}), 0)
           ::numeric(14,2)::text AS prev_amount,
         COUNT(*) FILTER (WHERE rs.erp_created_at < ${currentStart})::int  AS prev_orders
  FROM   report_sales rs
  LEFT   JOIN app_user u
         ON u.id = rs.user_id
  GROUP  BY rs.user_id
  ORDER  BY SUM(rs.amount) FILTER (WHERE rs.erp_created_at >= ${currentStart}) DESC NULLS LAST,
            2 ASC
`;
