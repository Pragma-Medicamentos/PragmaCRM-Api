import { Router } from 'express';
import { VisitsController } from './visits.controller';
import { validateBody } from '../middleware/validate';
import { confirmVisitSchema } from '../../domain/schemas/visit.schema';

export class VisitsRoutes {
  static get routes(): Router {
    const router = Router();
    const controller = new VisitsController();

    // requireAuth + requireRole(SELLER) are applied when the group is mounted
    // in presentation/routes.ts, not here (convention in CLAUDE.md 8.1).

    router.post('/', validateBody(confirmVisitSchema), controller.confirm);

    return router;
  }
}
