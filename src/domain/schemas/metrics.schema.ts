import { z } from 'zod';

/** Longest range the panel accepts: one year, leap day included. */
export const MAX_RANGE_DAYS = 366;

const MS_PER_DAY = 86_400_000;

/**
 * A local calendar day, `YYYY-MM-DD`. Deliberately not a timestamp: the
 * service turns it into El Salvador midnight (lib/localDateRange.ts), so the
 * client never has to know the offset.
 */
const localDay = z.iso.date('Expected a date in YYYY-MM-DD format');

/**
 * Filters every metrics endpoint accepts (RF-09 CA2).
 *
 * Both bounds are optional and default to the current month. The inactivity
 * threshold falls back to envs.INACTIVITY_THRESHOLD_DAYS in the service, so
 * the default can be changed without a deploy; the value actually used is
 * echoed back in `thresholds`.
 */
const rangeFields = z.object({
  from: localDay.optional(),
  to: localDay.optional(),
  inactivity_days: z.coerce.number().int().min(1).max(365).optional(),
});

type RangeShape = { from?: string; to?: string };

const withRangeChecks = <T extends z.ZodType<RangeShape>>(schema: T) =>
  schema
    // ISO dates compare correctly as strings.
    .refine((data) => !data.from || !data.to || data.from <= data.to, {
      message: '`from` must be earlier than or equal to `to`',
      path: ['from'],
    })
    .refine(
      (data) =>
        !data.from ||
        !data.to ||
        (Date.parse(data.to) - Date.parse(data.from)) / MS_PER_DAY + 1 <=
          MAX_RANGE_DAYS,
      { message: `The range cannot exceed ${MAX_RANGE_DAYS} days`, path: ['to'] }
    );

export const metricsRangeQuerySchema = withRangeChecks(rangeFields);
export type MetricsRangeQuery = z.infer<typeof rangeFields>;

/**
 * Every KPI of GET /metrics/kpis, in response order. Must list exactly the
 * keys of CompanyKpis: the check in domain/types/metrics.types.ts fails the
 * build if the two drift apart.
 */
export const KPI_NAMES = [
  'stops_executed',
  'stops_by_type',
  'visited_customers',
  'effective_visits_rate',
  'average_visit_minutes',
  'total_sales',
  'orders_count',
  'average_ticket',
  'average_monthly_sales',
  'route_effectiveness',
  'goal_compliance',
  'customers_without_visit',
  'recovered_customers',
  'new_prospects',
  'purchase_frequency_days',
  'overdue_portfolio',
  'pending_collections',
] as const;
export type KpiName = (typeof KPI_NAMES)[number];

/**
 * KPI selection of the batch endpoint: `?names=total_sales,average_ticket`,
 * or the param repeated (`?names=a&names=b`, which Express hands over as an
 * array). Omitted means every KPI. Duplicates collapse; an unknown name is a
 * 400. Only the selected KPIs are computed.
 */
const kpiSelection = z
  .union([z.string(), z.array(z.string())])
  .transform((raw) => [
    ...new Set(
      (Array.isArray(raw) ? raw : [raw])
        .flatMap((value) => value.split(','))
        .map((name) => name.trim())
        .filter((name) => name !== '')
    ),
  ])
  .pipe(
    z
      .array(
        z.enum(KPI_NAMES, {
          error: `Unknown KPI. Valid values: ${KPI_NAMES.join(', ')}`,
        })
      )
      .min(1, 'Select at least one KPI')
  );

const kpiValuesFields = rangeFields.extend({
  names: kpiSelection.optional(),
});

export const metricsKpiValuesQuerySchema = withRangeChecks(kpiValuesFields);
export type MetricsKpiValuesQuery = z.infer<typeof kpiValuesFields>;

/**
 * `:name` of GET /metrics/kpis/:name. Checked against KPI_NAMES in the
 * service, so an unknown KPI answers 404 like any unknown resource.
 */
export const metricsKpiParamsSchema = z.object({
  name: z.string().trim().min(1),
});
export type MetricsKpiParams = z.infer<typeof metricsKpiParamsSchema>;

/** Rows the product ranking returns when `limit` is omitted (PCRM-172). */
export const PRODUCT_RANKING_DEFAULT_LIMIT = 50;
export const PRODUCT_RANKING_MAX_LIMIT = 500;

const productsFields = rangeFields.extend({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PRODUCT_RANKING_MAX_LIMIT)
    .default(PRODUCT_RANKING_DEFAULT_LIMIT),
});

export const metricsProductsQuerySchema = withRangeChecks(productsFields);
export type MetricsProductsQuery = z.infer<typeof productsFields>;

export const TREND_GRANULARITIES = ['week', 'month'] as const;
export type TrendGranularity = (typeof TREND_GRANULARITIES)[number];

const trendsFields = rangeFields.extend({
  granularity: z.enum(TREND_GRANULARITIES).default('week'),
});

export const metricsTrendsQuerySchema = withRangeChecks(trendsFields);
export type MetricsTrendsQuery = z.infer<typeof trendsFields>;

// z.guid, not z.uuid: Zod 4's uuid() enforces the RFC version/variant bits and
// rejects the fixed ids of supabase/seed.sql ('1111...-1111-...'). The column
// is a Postgres uuid, which accepts any 8-4-4-4-12 hex string.
export const metricsSellerParamsSchema = z.object({
  id: z.guid('Invalid seller id'),
});
export type MetricsSellerParams = z.infer<typeof metricsSellerParamsSchema>;
