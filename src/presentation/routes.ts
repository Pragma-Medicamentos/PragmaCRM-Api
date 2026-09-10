import { Router } from 'express';
import { HealthRoutes } from './health/routes';
import { MeRoutes } from './me/routes';

export class AppRoutes {
  static get routes(): Router {
    const router = Router();

    // Publica: la consume el monitoreo del VPS.
    router.use('/api/health', HealthRoutes.routes);

    router.use('/api/v1/me', MeRoutes.routes);

    // router.use('/api/v1/goals', requireAuth, requireRole(ROLES.ADMIN), GoalsRoutes.routes);

    return router;
  }
}
