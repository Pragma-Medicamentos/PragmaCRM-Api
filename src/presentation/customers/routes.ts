import { Router } from 'express';
import { CustomersController } from './customers.controller';
import { validateBody, validateParams } from '../middleware/validate';
import {
  customerParamsSchema,
  updateCustomerLocationSchema,
} from '../../domain/schemas/customer.schema';

export class CustomersRoutes {
  static get routes(): Router {
    const router = Router();
    const controller = new CustomersController();

    // requireAuth + requireRole(ADMIN) se aplican al montar el grupo en routes.ts.
    router.patch(
      '/:id/location',
      validateParams(customerParamsSchema),
      validateBody(updateCustomerLocationSchema),
      controller.updateLocation
    );

    return router;
  }
}
