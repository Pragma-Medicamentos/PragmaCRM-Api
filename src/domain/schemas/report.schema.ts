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
