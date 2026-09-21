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
  listRoutesQuerySchema,
  reassignRouteSchema,
  routeAssignmentParamsSchema,
  routeParamsSchema,
  updateRouteSchema,
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

    return router;
  }
}
