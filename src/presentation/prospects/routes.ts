import { Router } from 'express';
import { ProspectsController } from './prospects.controller';
import { validateBody, validateQuery } from '../middleware/validate';
import { requireRole } from '../middleware/auth';
import { ROLES } from '../../domain/types/auth.types';
import {
  createProspectSchema,
  listProspectsQuerySchema,
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

    return router;
  }
}
