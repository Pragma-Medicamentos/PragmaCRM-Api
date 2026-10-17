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
import { goalParamsSchema, setGoalSchema } from '../../domain/schemas/goal.schema';

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
    router.post(
      '/:id/resend-otp',
      validateParams(sellerParamsSchema),
      controller.resendOtp
    );
    // PCRM-173: monthly goal in force from a month onward.
    router.get('/:id/goals', validateParams(sellerParamsSchema), controller.listGoals);
    router.put(
      '/:id/goals',
      validateParams(sellerParamsSchema),
      validateBody(setGoalSchema),
      controller.setGoal
    );
    router.delete(
      '/:id/goals/:goalId',
      validateParams(goalParamsSchema),
      controller.deleteGoal
    );

    return router;
  }
}
