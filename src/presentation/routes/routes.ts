import { Router } from 'express';
import { RoutesController } from './routes.controller';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../middleware/validate';
import {
  assignRouteSchema,
  createRouteSchema,
  createRouteStopSchema,
  listRoutesQuerySchema,
  reassignRouteSchema,
  reorderRouteStopsSchema,
  replaceRouteStopsSchema,
  routeAssignmentParamsSchema,
  routeParamsSchema,
  routeStopParamsSchema,
  updateRouteSchema,
  updateRouteStopSchema,
} from '../../domain/schemas/route.schema';

export class RoutesRoutes {
  static get routes(): Router {
    const router = Router();
    const controller = new RoutesController();

    // requireAuth + requireRole(ADMIN) are applied when this group is mounted
    // in presentation/routes.ts, not here (see convention in CLAUDE.md 8.1).
    router.get('/', validateQuery(listRoutesQuerySchema), controller.list);
    router.get('/:id', validateParams(routeParamsSchema), controller.getById);
    router.post('/', validateBody(createRouteSchema), controller.create);
    router.patch(
      '/:id',
      validateParams(routeParamsSchema),
      validateBody(updateRouteSchema),
      controller.update
    );
    router.get(
      '/:id/assignments',
      validateParams(routeParamsSchema),
      controller.listAssignments
    );
    router.post(
      '/:id/assignments',
      validateParams(routeParamsSchema),
      validateBody(assignRouteSchema),
      controller.assign
    );
    router.post(
      '/:id/reassign',
      validateParams(routeParamsSchema),
      validateBody(reassignRouteSchema),
      controller.reassign
    );
    router.delete(
      '/:id/assignments/:day',
      validateParams(routeAssignmentParamsSchema),
      controller.unassign
    );

    router.get('/:id/stops', validateParams(routeParamsSchema), controller.listStops);
    router.post(
      '/:id/stops',
      validateParams(routeParamsSchema),
      validateBody(createRouteStopSchema),
      controller.addStop
    );
    // Must precede /:id/stops/:stopId so 'order' and root are not parsed as stop ids.
    router.put(
      '/:id/stops',
      validateParams(routeParamsSchema),
      validateBody(replaceRouteStopsSchema),
      controller.replaceStops
    );
    router.put(
      '/:id/stops/order',
      validateParams(routeParamsSchema),
      validateBody(reorderRouteStopsSchema),
      controller.reorderStops
    );
    router.patch(
      '/:id/stops/:stopId',
      validateParams(routeStopParamsSchema),
      validateBody(updateRouteStopSchema),
      controller.updateStop
    );
    router.delete(
      '/:id/stops/:stopId',
      validateParams(routeStopParamsSchema),
      controller.removeStop
    );

    return router;
  }
}
