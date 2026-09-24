import { Router } from 'express';
import { DailyRouteController } from './daily-route.controller';
import { validateQuery } from '../middleware/validate';
import { dailyRouteQuerySchema } from '../../domain/schemas/daily-route.schema';

export class DailyRouteRoutes {
  static get routes(): Router {
    const router = Router();
    const controller = new DailyRouteController();

    // requireAuth + requireRole(SELLER) are applied when this group is
    // mounted in presentation/routes.ts, not here (CLAUDE.md 8.1 convention).
    router.get('/', validateQuery(dailyRouteQuerySchema), controller.get);

    return router;
  }
}
