import { Router } from 'express';
import { DailyRouteController } from './daily-route.controller';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../middleware/validate';
import {
  dailyRouteQuerySchema,
  setStopLocationSchema,
  stopParamsSchema,
} from '../../domain/schemas/daily-route.schema';

export class DailyRouteRoutes {
  static get routes(): Router {
    const router = Router();
    const controller = new DailyRouteController();

    // requireAuth + requireRole(SELLER) are applied when this group is
    // mounted in presentation/routes.ts, not here (CLAUDE.md 8.1 convention).
    router.get('/', validateQuery(dailyRouteQuerySchema), controller.get);

    // PCRM-160: the seller may fill an empty customer pin, never move one.
    router.patch(
      '/stops/:id/location',
      validateParams(stopParamsSchema),
      validateBody(setStopLocationSchema),
      controller.setLocation
    );

    return router;
  }
}
