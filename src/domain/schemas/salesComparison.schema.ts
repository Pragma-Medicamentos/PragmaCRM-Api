import { z } from 'zod';
import { paginationQuerySchema } from './pagination.schema';
import { rangeFields, withRangeChecks } from './metrics.schema';

/** How the breakdown table groups the sales: one row per customer or per seller. */
export const SALES_GROUP_BY = ['customer', 'seller'] as const;
export type SalesGroupBy = (typeof SALES_GROUP_BY)[number];

/**
 * GET /metrics/sales/comparison (PCRM-187).
 *
 * The panel's `from` / `to` (same defaults and 366-day cap as every metrics
 * endpoint), two optional filters that combine with AND, and an optional
 * `group_by` that adds a paginated breakdown. Without `group_by`, `page` and
 * `limit` are accepted and ignored, so the web can keep one query object.
 *
 * z.guid, not z.uuid, for the reason given in metrics.schema.ts: Zod 4's
 * uuid() rejects the fixed ids of supabase/seed.sql.
 */
const salesComparisonFields = rangeFields.extend({
  customer_id: z.guid('Invalid customer id').optional(),
  user_id: z.guid('Invalid seller id').optional(),
  group_by: z.enum(SALES_GROUP_BY).optional(),
  ...paginationQuerySchema.shape,
});

export const salesComparisonQuerySchema = withRangeChecks(salesComparisonFields);
export type SalesComparisonQuery = z.infer<typeof salesComparisonFields>;
