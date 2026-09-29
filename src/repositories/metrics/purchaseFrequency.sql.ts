import { Prisma } from '../../generated/prisma/client';
import { PURCHASE_FREQUENCY_BUCKETS } from '../../domain/constants/metrics';
import { LocalDateRange } from '../../lib/localDateRange';
import { saleGapsCte } from './fragments.sql';

/**
 * Average days between consecutive purchases per customer, over the purchases
 * of the period, bucketed. Customers who bought in the period with no earlier
 * purchase to compare against are counted as insufficient data.
 */
export const purchaseFrequencySql = (range: LocalDateRange): Prisma.Sql => {
  const bucketCounts = PURCHASE_FREQUENCY_BUCKETS.map(({ min_days, max_days }) =>
    max_days === null
      ? Prisma.sql`COUNT(*) FILTER (WHERE avg_days >= ${min_days})::int`
      : Prisma.sql`COUNT(*) FILTER (WHERE avg_days BETWEEN ${min_days} AND ${max_days})::int`
  );

  return Prisma.sql`
    WITH
    ${saleGapsCte(range)},
    per_customer AS (
      SELECT customer_id, ROUND(AVG(gap_days)) AS avg_days
      FROM   gaps
      WHERE  erp_created_at >= ${range.start}
      GROUP  BY customer_id
    )
    SELECT ARRAY[${Prisma.join(bucketCounts)}]             AS bucket_counts,
           COUNT(*) FILTER (WHERE avg_days IS NULL)::int   AS insufficient_data,
           ROUND(AVG(avg_days))::int                       AS average_days
    FROM   per_customer
  `;
};
