import { Router } from 'express';
import { ProductRequestsController } from './product-requests.controller';
import { validateBody } from '../middleware/validate';
import { createProductRequestSchema } from '../../domain/schemas/product-request.schema';

export class ProductRequestsRoutes {
  static get routes(): Router {
    const router = Router();
    const controller = new ProductRequestsController();

    // requireAuth + requireRole(SELLER) are applied when the group is mounted
    // in presentation/routes.ts, not here (convention in CLAUDE.md 8.1).

    router.post('/', validateBody(createProductRequestSchema), controller.create);

    return router;
  }
}
