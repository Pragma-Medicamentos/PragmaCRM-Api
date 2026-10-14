import { Router } from 'express';
import { ExecutedRoutesController } from './executed-routes.controller';
import { validateQuery } from '../middleware/validate';
import { executedRoutesQuerySchema } from '../../domain/schemas/executed-route.schema';

export class ExecutedRoutesRoutes {
  static get routes(): Router {
    const router = Router();
    const controller = new ExecutedRoutesController();

    // requireAuth + requireRole(ADMIN) are applied when this group is
    // mounted in presentation/routes.ts, not here (CLAUDE.md 8.1).
    router.get('/', validateQuery(executedRoutesQuerySchema), controller.list);

    return router;
  }
}
