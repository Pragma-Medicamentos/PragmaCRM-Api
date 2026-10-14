import { Client } from '../lib/prisma';
import { LocalDateRange } from '../lib/localDateRange';
import { executedStopsSql, plannedStopsSql } from './executed-routes/executed-routes.sql';

/*
 * Raw-SQL data access of the executed-routes history (HU-08). The SQL text
 * lives in ./executed-routes/executed-routes.sql.ts.
 */

/** Row of executedStopsSql. */
export interface ExecutedStopRow {
  visit_id: string;
  scheduled_visit_id: string | null;
  seller_id: string;
  seller_name: string;
  local_date: string;
  route_user_id: string | null;
  route_id: string | null;
  route_name: string | null;
  customer_id: string;
  customer_name: string;
  customer_trade_name: string | null;
  stop_type: string | null;
  is_extra: boolean;
  started_at: Date | null;
  finished_at: Date | null;
  lat: number | null;
  lng: number | null;
  distance_meters: number | null;
  successful: boolean | null;
  no_order_reason: string | null;
  notes: string | null;
}

/** Row of plannedStopsSql. */
export interface PlannedStopsRow {
  route_user_id: string;
  local_date: string;
  planned: number;
}

export const findExecutedStops = (
  client: Client,
  range: LocalDateRange,
  sellerId?: string
): Promise<ExecutedStopRow[]> =>
  client.$queryRaw<ExecutedStopRow[]>(executedStopsSql(range, sellerId));

export const findPlannedStops = async (
  client: Client,
  routeUserIds: string[],
  range: LocalDateRange
): Promise<PlannedStopsRow[]> => {
  if (routeUserIds.length === 0) return [];
  return client.$queryRaw<PlannedStopsRow[]>(
    plannedStopsSql(routeUserIds, range.from, range.to)
  );
};
