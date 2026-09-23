import { PrismaClient } from '../generated/prisma/client';
import {
  RouteStopRecord,
  applyRouteStopOrder,
  assertReorderCoversActiveStops,
  getRouteById,
  listRouteStops,
} from '../services/route.service';

/**
 * Full reorder of a route's active stops (RF-04). Runs inside a transaction
 * so a crash mid-reorder cannot leave sort_order duplicated or gapped.
 */
export const reorderRouteStops = async (
  client: PrismaClient,
  routeId: string,
  stopIds: string[]
): Promise<RouteStopRecord[]> => {
  await getRouteById(client, routeId);
  await assertReorderCoversActiveStops(client, routeId, stopIds);

  return client.$transaction(async (tx) => {
    await applyRouteStopOrder(tx, stopIds);
    return listRouteStops(tx, routeId);
  });
};
