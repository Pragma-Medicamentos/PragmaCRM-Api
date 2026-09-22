import { Router } from 'express';
import { ProspectsController } from './prospects.controller';
import { validateBody } from '../middleware/validate';
import { createProspectSchema } from '../../domain/schemas/prospect.schema';

export class ProspectsRoutes {
  static get routes(): Router {
    const router = Router();
    const controller = new ProspectsController();

    // requireAuth + requireRole(SELLER) are applied when the group is mounted
    // in presentation/routes.ts, not here (convention in CLAUDE.md 8.1).

    router.post('/', validateBody(createProspectSchema), controller.create);

    return router;
  }
}
