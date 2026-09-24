import { Router } from 'express';
import { ProspectsController } from './prospects.controller';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../middleware/validate';
import { requireRole } from '../middleware/auth';
import { ROLES } from '../../domain/types/auth.types';
import {
  createProspectAdminSchema,
  createProspectSchema,
  listProspectsQuerySchema,
  prospectParamsSchema,
  updateProspectLocationSchema,
} from '../../domain/schemas/prospect.schema';

export class ProspectsRoutes {
  static get routes(): Router {
    const router = Router();
    const controller = new ProspectsController();

    // requireAuth is applied when the group is mounted in presentation/routes.ts.
    // Roles differ per verb (SELLER creates, ADMIN lists), so requireRole lives here.

    router.get(
      '/',
      requireRole(ROLES.ADMIN),
      validateQuery(listProspectsQuerySchema),
      controller.list
    );

    router.post(
      '/',
      requireRole(ROLES.SELLER),
      validateBody(createProspectSchema),
      controller.create
    );

    router.post(
      '/admin',
      requireRole(ROLES.ADMIN),
      validateBody(createProspectAdminSchema),
      controller.createAdmin
    );

    router.patch(
      '/:id/location',
      requireRole(ROLES.ADMIN),
      validateParams(prospectParamsSchema),
      validateBody(updateProspectLocationSchema),
      controller.updateLocation
    );

    return router;
  }
}
