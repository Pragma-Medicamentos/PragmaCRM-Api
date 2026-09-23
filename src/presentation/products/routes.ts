import { Router } from 'express';
import { ProductsController } from './products.controller';
import { validateParams, validateQuery } from '../middleware/validate';
import {
  listProductsQuerySchema,
  productParamsSchema,
} from '../../domain/schemas/product.schema';

export class ProductsRoutes {
  static get routes(): Router {
    const router = Router();
    const controller = new ProductsController();

    // requireAuth + requireRole(ADMIN) are applied when the group is mounted
    // in presentation/routes.ts, not here (convention in CLAUDE.md 8.1).

    router.get('/', validateQuery(listProductsQuerySchema), controller.list);
    router.get(
      '/:id',
      validateParams(productParamsSchema),
      controller.getById
    );

    return router;
  }
}
