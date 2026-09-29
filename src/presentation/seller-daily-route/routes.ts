import { Router } from 'express';
import { SellerDailyRouteController } from './seller-daily-route.controller';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../middleware/validate';
import {
  createExtraStopSchema,
  extraStopParamsSchema,
  sellerIdParamSchema,
} from '../../domain/schemas/extra-stop.schema';
import { dailyRouteQuerySchema } from '../../domain/schemas/daily-route.schema';

export class SellerDailyRouteRoutes {
  static get routes(): Router {
    // mergeParams: this router is mounted under a path carrying :sellerId
    // (presentation/routes.ts), and needs it in req.params.
    const router = Router({ mergeParams: true });
    const controller = new SellerDailyRouteController();

    // requireAuth + requireRole(ADMIN) are applied when this group is
    // mounted in presentation/routes.ts, not here (CLAUDE.md 8.1).
    router.get(
      '/',
      validateParams(sellerIdParamSchema),
      validateQuery(dailyRouteQuerySchema),
      controller.getDay
    );
    router.post(
      '/extra-stops',
      validateParams(sellerIdParamSchema),
      validateBody(createExtraStopSchema),
      controller.createExtraStop
    );
    router.delete(
      '/extra-stops/:stopId',
      validateParams(extraStopParamsSchema),
      controller.deleteExtraStop
    );

    return router;
  }
}
