import { Client } from '../lib/prisma';
import {
  RouteHistoryStopRow,
  routeHistorySql,
} from './route-history/route-history.sql';

export type { RouteHistoryStopRow };

/** Newest day first; inside a day, in the order of GET /me/route. */
export const findRouteHistoryRows = (
  client: Client,
  sellerId: string,
  before: string,
  dayCount: number
): Promise<RouteHistoryStopRow[]> =>
  client.$queryRaw<RouteHistoryStopRow[]>(routeHistorySql(sellerId, before, dayCount));
