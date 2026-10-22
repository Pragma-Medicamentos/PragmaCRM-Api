import { z } from 'zod';
import {
  kpiValuesFields,
  productsFields,
  rangeFields,
  trendsFields,
  withRangeChecks,
} from './metrics.schema';

/*
 * Query of the report endpoints (PCRM reports): the same filters as the
 * metrics endpoint each report mirrors, plus the output format. Extending the
 * metrics field objects keeps both in lockstep: a filter added to a metrics
 * endpoint reaches its report without touching this file.
 */

export const REPORT_FORMATS = ['xlsx', 'pdf'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

const formatField = {
  format: z.enum(REPORT_FORMATS).default('xlsx'),
};

const reportRangeFields = rangeFields.extend(formatField);
export const reportRangeQuerySchema = withRangeChecks(reportRangeFields);
export type ReportRangeQuery = z.infer<typeof reportRangeFields>;

const reportKpisFields = kpiValuesFields.extend(formatField);
export const reportKpisQuerySchema = withRangeChecks(reportKpisFields);
export type ReportKpisQuery = z.infer<typeof reportKpisFields>;

const reportProductsFields = productsFields.extend(formatField);
export const reportProductsQuerySchema = withRangeChecks(reportProductsFields);
export type ReportProductsQuery = z.infer<typeof reportProductsFields>;

const reportTrendsFields = trendsFields.extend(formatField);
export const reportTrendsQuerySchema = withRangeChecks(reportTrendsFields);
export type ReportTrendsQuery = z.infer<typeof reportTrendsFields>;

/*
 * Management reports (PCRM-159). Unlike the reports above they do not mirror a
 * metrics endpoint: they run their own SQL (repositories/reports/), which is
 * what lets them take the zone / seller / route filters the metrics panel
 * does not have. All three combine with AND.
 *
 * - zone: `route.zone`, the zone of the route a sale or visit is attributed
 *   to. The importer never fills customer.zone, so the route is the only
 *   source with data (decided with the team for PCRM-159).
 * - user_id: the seller (`sale.user_id`, `visit.user_id`).
 * - route_id: the route a sale or visit is attributed to (CLAUDE.md 5.4).
 *
 * z.guid, not z.uuid, for the reason given in metrics.schema.ts: Zod 4's
 * uuid() rejects the fixed ids of supabase/seed.sql.
 */
const managementFields = rangeFields.extend({
  ...formatField,
  zone: z.string().trim().min(1).max(100).optional(),
  user_id: z.guid('Invalid seller id').optional(),
  route_id: z.guid('Invalid route id').optional(),
});
export const managementReportQuerySchema = withRangeChecks(managementFields);
export type ManagementReportQuery = z.infer<typeof managementFields>;

/** Rows per table of the rankings report when `limit` is omitted. */
export const RANKINGS_DEFAULT_LIMIT = 50;
export const RANKINGS_MAX_LIMIT = 500;

const rankingsFields = managementFields.extend({
  limit: z.coerce.number().int().min(1).max(RANKINGS_MAX_LIMIT).default(RANKINGS_DEFAULT_LIMIT),
});
export const rankingsReportQuerySchema = withRangeChecks(rankingsFields);
export type RankingsReportQuery = z.infer<typeof rankingsFields>;

/** What GET /reports/sales/:group adds the sales up by. */
export const SALES_REPORT_GROUPS = [
  'seller',
  'customer',
  'municipality',
  'route',
  'zone',
  'product',
] as const;
export type SalesReportGroup = (typeof SALES_REPORT_GROUPS)[number];

export const salesReportParamsSchema = z.object({
  group: z.enum(SALES_REPORT_GROUPS),
});
export type SalesReportParams = z.infer<typeof salesReportParamsSchema>;

/** What GET /reports/abc/:entity classifies. */
export const ABC_ENTITIES = ['customer', 'product'] as const;
export type AbcEntity = (typeof ABC_ENTITIES)[number];

export const abcReportParamsSchema = z.object({
  entity: z.enum(ABC_ENTITIES),
});
export type AbcReportParams = z.infer<typeof abcReportParamsSchema>;
