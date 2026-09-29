import { KpiName } from '../schemas/metrics.schema';
import { KpiCatalogEntry } from '../types/metrics.types';

/**
 * What each KPI of the metrics panel is, independent of how it is computed
 * (that lives in repositories/metrics/kpiRegistry.ts). Served as-is by
 * GET /metrics/kpis so the dashboard can build its cards without hardcoding
 * units or which threshold tag goes next to which card.
 *
 * A Record over KpiName: adding a name to KPI_NAMES without describing it
 * here fails the build.
 */
export const KPI_CATALOG: Record<KpiName, Omit<KpiCatalogEntry, 'name'>> = {
  stops_executed: { unit: 'count', has_previous_period: true, thresholds: [] },
  stops_by_type: { unit: 'count', has_previous_period: true, thresholds: [] },
  visited_customers: { unit: 'count', has_previous_period: true, thresholds: [] },
  effective_visits_rate: { unit: 'percent', has_previous_period: true, thresholds: [] },
  average_visit_minutes: { unit: 'minutes', has_previous_period: true, thresholds: [] },
  total_sales: { unit: 'money', has_previous_period: true, thresholds: [] },
  orders_count: { unit: 'count', has_previous_period: true, thresholds: [] },
  average_ticket: { unit: 'money', has_previous_period: true, thresholds: [] },
  average_monthly_sales: { unit: 'money', has_previous_period: true, thresholds: [] },
  route_effectiveness: { unit: 'money', has_previous_period: true, thresholds: [] },
  goal_compliance: { unit: 'percent', has_previous_period: true, thresholds: [] },
  customers_without_visit: {
    unit: 'count',
    has_previous_period: true,
    thresholds: ['inactivity_days'],
  },
  recovered_customers: {
    unit: 'count',
    has_previous_period: true,
    thresholds: ['inactivity_days'],
  },
  new_prospects: { unit: 'count', has_previous_period: true, thresholds: [] },
  purchase_frequency_days: { unit: 'days', has_previous_period: true, thresholds: [] },
  // Snapshots as of today: no period, so nothing to compare against.
  overdue_portfolio: {
    unit: 'money',
    has_previous_period: false,
    thresholds: ['credit_term_days'],
  },
  pending_collections: { unit: 'money', has_previous_period: false, thresholds: [] },
};
