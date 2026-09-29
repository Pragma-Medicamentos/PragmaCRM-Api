import { PrismaClient } from '../generated/prisma/client';
import { CustomError } from '../domain/errors/CustomError';
import { ReassignRouteInput } from '../domain/schemas/route.schema';
import {
  RouteAssignmentRecord,
  assertActiveSeller,
  createRouteAssignment,
  getActiveAssignmentForDay,
  getRouteById,
  lockRouteDay,
  softDeleteRouteAssignment,
} from '../services/route.service';

/**
 * route_user has no `date` column: reassigning is closing the vigency of the
 * active row and opening a new one, atomically (CLAUDE.md 5.1/7.4) — never an
 * update of the existing assignment.
 */
export const reassignRoute = async (
  client: PrismaClient,
  routeId: string,
  data: ReassignRouteInput
): Promise<RouteAssignmentRecord> => {
  await getRouteById(client, routeId);
  await assertActiveSeller(client, data.user_id);

  return client.$transaction(async (tx) => {
    await lockRouteDay(tx, routeId, data.day);

    const current = await getActiveAssignmentForDay(tx, routeId, data.day);
    if (!current) {
      throw CustomError.badRequest(
        'No active assignment for this day; use the assignment endpoint instead'
      );
    }
    if (current.user_id === data.user_id) {
      throw CustomError.conflict('Vendor is already assigned to this day');
    }

    await softDeleteRouteAssignment(tx, current.id);
    return createRouteAssignment(tx, routeId, data);
  });
};
