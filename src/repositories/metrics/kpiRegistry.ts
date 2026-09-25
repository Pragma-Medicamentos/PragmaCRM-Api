import { Prisma } from '../../generated/prisma/client';
import { KpiName } from '../../domain/schemas/metrics.schema';
import { CompanyKpis, KpiValue } from '../../domain/types/metrics.types';
import { KpiWindow } from './fragments.sql';
import { stopsExecutedSql } from './kpis/stops_executed.sql';
import { stopsByTypeSql } from './kpis/stops_by_type.sql';
import { visitedCustomersSql } from './kpis/visited_customers.sql';
import { effectiveVisitsRateSql } from './kpis/effective_visits_rate.sql';
import { averageVisitMinutesSql } from './kpis/average_visit_minutes.sql';
import { totalSalesSql } from './kpis/total_sales.sql';
import { ordersCountSql } from './kpis/orders_count.sql';
import { averageTicketSql } from './kpis/average_ticket.sql';
import { averageMonthlySalesSql } from './kpis/average_monthly_sales.sql';
import { routeEffectivenessSql } from './kpis/route_effectiveness.sql';
import { goalComplianceSql } from './kpis/goal_compliance.sql';
import { customersWithoutVisitSql } from './kpis/customers_without_visit.sql';
import { recoveredCustomersSql } from './kpis/recovered_customers.sql';
import { purchaseFrequencyDaysSql } from './kpis/purchase_frequency_days.sql';
import { newProspectsSql } from './kpis/new_prospects.sql';
import { overduePortfolioSql } from './kpis/overdue_portfolio.sql';
import { pendingCollectionsSql } from './kpis/pending_collections.sql';

/*
 * One entry per KPI: the query that computes it (./kpis/<name>.sql.ts) and
 * how its single result row becomes the value. Each KPI runs alone, so a
 * request computes exactly what it asks for.
 *
 * Every query returns one row covering both periods: `value` for the selected
 * one and `previous_value` for the one before, split with FILTER over a single
 * scan (see inWindow in fragments.sql.ts).
 *
 * A mapped type over KpiName: a KPI without an entry fails the build.
 */

interface KpiQuery<K extends KpiName> {
  sql: (window: KpiWindow) => Prisma.Sql;
  map: (row: Record<string, unknown>) => CompanyKpis[K];
}

type KpiRegistry = { [K in KpiName]: KpiQuery<K> };

/** The common row shape: one column per period. */
const scalar = <T>(row: Record<string, unknown>): KpiValue<T> => ({
  value: row.value as T,
  previous_value: row.previous_value as T | null,
});

export const KPI_REGISTRY: KpiRegistry = {
  stops_executed: { sql: stopsExecutedSql, map: scalar },
  stops_by_type: {
    sql: stopsByTypeSql,
    map: (row) => ({
      value: {
        visit: row.visit as number,
        dispatch: row.dispatch as number,
        collection: row.collection as number,
      },
      previous_value: {
        visit: row.previous_visit as number,
        dispatch: row.previous_dispatch as number,
        collection: row.previous_collection as number,
      },
    }),
  },
  visited_customers: { sql: visitedCustomersSql, map: scalar },
  effective_visits_rate: { sql: effectiveVisitsRateSql, map: scalar },
  average_visit_minutes: { sql: averageVisitMinutesSql, map: scalar },
  total_sales: { sql: totalSalesSql, map: scalar },
  orders_count: { sql: ordersCountSql, map: scalar },
  average_ticket: { sql: averageTicketSql, map: scalar },
  average_monthly_sales: { sql: averageMonthlySalesSql, map: scalar },
  route_effectiveness: { sql: routeEffectivenessSql, map: scalar },
  goal_compliance: { sql: goalComplianceSql, map: scalar },
  customers_without_visit: { sql: customersWithoutVisitSql, map: scalar },
  recovered_customers: { sql: recoveredCustomersSql, map: scalar },
  purchase_frequency_days: { sql: purchaseFrequencyDaysSql, map: scalar },
  new_prospects: { sql: newProspectsSql, map: scalar },
  // Snapshots ignore the window: they describe today.
  overdue_portfolio: { sql: () => overduePortfolioSql(), map: scalar },
  pending_collections: { sql: () => pendingCollectionsSql(), map: scalar },
};
