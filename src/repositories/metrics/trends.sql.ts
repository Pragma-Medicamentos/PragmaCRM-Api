import { Prisma } from '../../generated/prisma/client';
import { ERP_STATUS_SALE } from '../../domain/constants/businessRules';
import { TrendGranularity } from '../../domain/schemas/metrics.schema';
import { LocalDateRange } from '../../lib/localDateRange';
import {
  TZ,
  VISIT_AT,
  SALE_AT,
  inRange,
} from './fragments.sql';

/**
 * Stops and sales per local week or month. Buckets without activity are
 * returned as zeros so a chart has no holes. The first and last buckets may
 * reach outside the range, but only activity inside it is counted.
 */
export const trendsSql = (
  range: LocalDateRange,
  granularity: TrendGranularity,
  sellerId?: string
): Prisma.Sql => {
  // Validated by the Zod enum, never free text.
  const unit = Prisma.raw(`'${granularity}'`);
  const step = Prisma.raw(`interval '1 ${granularity}'`);
  const visitSeller = sellerId ? Prisma.sql`AND v.user_id = ${sellerId}::uuid` : Prisma.empty;
  const saleSeller = sellerId ? Prisma.sql`AND s.user_id = ${sellerId}::uuid` : Prisma.empty;

  return Prisma.sql`
    WITH
    buckets AS (
      SELECT generate_series(
               date_trunc(${unit}, ${range.from}::date::timestamp),
               date_trunc(${unit}, ${range.to}::date::timestamp),
               ${step}
             ) AS bucket
    ),
    vv AS (
      SELECT date_trunc(${unit}, v.started_at AT TIME ZONE ${TZ}) AS bucket,
             COUNT(*) AS stops
      FROM   visit v
      WHERE  v.deleted_at IS NULL
        AND  ${inRange(VISIT_AT, range)} ${visitSeller}
      GROUP  BY 1
    ),
    ss AS (
      SELECT date_trunc(${unit}, s.erp_created_at AT TIME ZONE ${TZ}) AS bucket,
             COUNT(*)     AS orders,
             SUM(s.total) AS sales
      FROM   sale s
      WHERE  s.deleted_at IS NULL
        AND  s.erp_status = ${ERP_STATUS_SALE}
        AND  ${inRange(SALE_AT, range)} ${saleSeller}
      GROUP  BY 1
    )
    SELECT to_char(b.bucket, 'YYYY-MM-DD')           AS bucket_start,
           COALESCE(vv.stops, 0)::int                 AS stops,
           COALESCE(ss.orders, 0)::int                AS orders_count,
           COALESCE(ss.sales, 0)::numeric(14,2)::text AS total_sales,
           (ss.sales / NULLIF(ss.orders, 0))::numeric(14,2)::text AS average_ticket
    FROM   buckets b
    LEFT   JOIN vv ON vv.bucket = b.bucket
    LEFT   JOIN ss ON ss.bucket = b.bucket
    ORDER  BY b.bucket
  `;
};
