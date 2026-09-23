import { Router } from 'express';
import { CustomersController } from './customers.controller';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../middleware/validate';
import {
  customerParamsSchema,
  listCustomerCreditsQuerySchema,
  listCustomerSalesQuerySchema,
  listCustomersQuerySchema,
  updateCustomerLocationSchema,
} from '../../domain/schemas/customer.schema';

export class CustomersRoutes {
  static get routes(): Router {
    const router = Router();
    const controller = new CustomersController();

    // requireAuth + requireRole(ADMIN) are applied when the group is mounted
    // in presentation/routes.ts, not here (convention in CLAUDE.md 8.1).

    router.get('/', validateQuery(listCustomersQuerySchema), controller.list);

    router.get(
      '/:id',
      validateParams(customerParamsSchema),
      controller.getById
    );
    router.get(
      '/:id/sales',
      validateParams(customerParamsSchema),
      validateQuery(listCustomerSalesQuerySchema),
      controller.listSales
    );
    router.get(
      '/:id/credits',
      validateParams(customerParamsSchema),
      validateQuery(listCustomerCreditsQuerySchema),
      controller.listCredits
    );
    router.patch(
      '/:id/location',
      validateParams(customerParamsSchema),
      validateBody(updateCustomerLocationSchema),
      controller.updateLocation
    );

    return router;
  }
}
