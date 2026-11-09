import { Router } from 'express';
import { ProductRequestsController } from './product-requests.controller';
import { validateBody, validateParams, validateQuery } from '../middleware/validate';
import { requireRole } from '../middleware/auth';
import { ROLES } from '../../domain/types/auth.types';
import {
  createProductRequestSchema,
  demandedProductsQuerySchema,
  offCatalogDemandQuerySchema,
  offCatalogProductParamsSchema,
} from '../../domain/schemas/product-request.schema';

export class ProductRequestsRoutes {
  static get routes(): Router {
    const router = Router();
    const controller = new ProductRequestsController();

    // requireAuth is on the mount; roles differ per verb.

    router.post(
      '/',
      requireRole(ROLES.SELLER),
      validateBody(createProductRequestSchema),
      controller.create
    );

    router.get(
      '/products',
      requireRole(ROLES.SELLER, ROLES.ADMIN),
      validateQuery(demandedProductsQuerySchema),
      controller.demandedProducts
    );

    router.get(
      '/demand',
      requireRole(ROLES.ADMIN),
      validateQuery(offCatalogDemandQuerySchema),
      controller.demand
    );

    router.get(
      '/demand/:id',
      requireRole(ROLES.ADMIN),
      validateParams(offCatalogProductParamsSchema),
      validateQuery(offCatalogDemandQuerySchema),
      controller.demandDetail
    );

    return router;
  }
}
