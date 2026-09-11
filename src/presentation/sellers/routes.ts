import { Router } from 'express';
import { SellersController } from './sellers.controller';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../middleware/validate';
import {
  createSellerSchema,
  listSellersQuerySchema,
  sellerParamsSchema,
  updateSellerSchema,
  updateSellerStatusSchema,
} from '../../domain/schemas/seller.schema';

export class SellersRoutes {
  static get routes(): Router {
    const router = Router();
    const controller = new SellersController();

    // requireAuth + requireRole(ADMIN) se aplican al montar el grupo en
    // presentation/routes.ts, no aqui (ver convencion en 8.1).
    router.get('/', validateQuery(listSellersQuerySchema), controller.list);
    router.get('/:id', validateParams(sellerParamsSchema), controller.getById);
    router.post('/', validateBody(createSellerSchema), controller.create);
    router.patch(
      '/:id',
      validateParams(sellerParamsSchema),
      validateBody(updateSellerSchema),
      controller.update
    );
    router.patch(
      '/:id/active',
      validateParams(sellerParamsSchema),
      validateBody(updateSellerStatusSchema),
      controller.updateStatus
    );

    return router;
  }
}
