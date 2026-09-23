import { PrismaClient } from '../generated/prisma/client';
import { CustomError } from '../domain/errors/CustomError';
import { AssignRouteInput } from '../domain/schemas/route.schema';
import {
  RouteAssignmentRecord,
  assertActiveSeller,
  createRouteAssignment,
  getActiveAssignmentForDay,
  getRouteById,
  lockRouteDay,
} from '../services/route.service';

/**
 * Fails with 409 when the day is already covered, so the caller reaches for
 * the reassignment endpoint instead of silently displacing a vendor.
 */
export const assignRoute = async (
  client: PrismaClient,
  routeId: string,
  data: AssignRouteInput
): Promise<RouteAssignmentRecord> => {
  await getRouteById(client, routeId);
  await assertActiveSeller(client, data.user_id);

  return client.$transaction(async (tx) => {
    await lockRouteDay(tx, routeId, data.day);

    const existing = await getActiveAssignmentForDay(tx, routeId, data.day);
    if (existing) {
      throw CustomError.conflict(
        'This day already has an active vendor assigned; use the reassignment endpoint instead'
      );
    }

    return createRouteAssignment(tx, routeId, data);
  });
};
