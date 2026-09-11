import { Router } from 'express';
import { HealthRoutes } from './health/routes';
import { UploadsRoutes } from './uploads/routes';

export class AppRoutes {
  static get routes(): Router {
    const router = Router();

    router.use('/api/health', HealthRoutes.routes);

    // CRM modules are mounted here under /api/v1/<resource>.
    router.use('/api/v1/uploads', UploadsRoutes.routes);

    return router;
  }
}
