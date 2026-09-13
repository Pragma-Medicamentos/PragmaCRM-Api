import { Router } from 'express';
import { HealthRoutes } from './health/routes';
import { UploadsRoutes } from './uploads/routes';
import { MeRoutes } from './me/routes';
import { AuthRoutes } from './auth/routes';
import { SellersRoutes } from './sellers/routes';
import { requireAuth, requireRole } from './middleware/auth';
import { ROLES } from '../domain/types/auth.types';

export class AppRoutes {
  static get routes(): Router {
    const router = Router();

    // Publica: la consume el monitoreo del VPS.
    router.use('/api/health', HealthRoutes.routes);

    // CRM modules are mounted here under /api/v1/<resource>.
    // RF-03: the guards must stay HERE, ahead of the multer middleware inside
    // the module, so an anonymous request is rejected before 100 MB is buffered.
    router.use(
      '/api/v1/uploads',
      requireAuth,
      requireRole(ROLES.ADMIN),
      UploadsRoutes.routes
    );
    router.use('/api/v1/me', MeRoutes.routes);

    // Public: sends OTP for accounts provisioned by the API (sellers/admins).
    router.use('/api/v1/auth', AuthRoutes.routes);

    // RF-01: alta, edicion y habilitacion/deshabilitacion de vendedores.
    router.use(
      '/api/v1/sellers',
      requireAuth,
      requireRole(ROLES.ADMIN),
      SellersRoutes.routes
    );

    // router.use('/api/v1/goals', requireAuth, requireRole(ROLES.ADMIN), GoalsRoutes.routes);

    return router;
  }
}
