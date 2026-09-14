import { Router } from 'express';
import { HealthRoutes } from './health/routes';
import { UploadsRoutes } from './uploads/routes';
import { MeRoutes } from './me/routes';
import { SellersRoutes } from './sellers/routes';
import { CustomersRoutes } from './customers/routes';
import { requireAuth, requireRole } from './middleware/auth';
import { ROLES } from '../domain/types/auth.types';

export class AppRoutes {
  static get routes(): Router {
    const router = Router();

    // Publica: la consume el monitoreo del VPS.
    router.use('/api/health', HealthRoutes.routes);

    // CRM modules are mounted here under /api/v1/<resource>.
    router.use('/api/v1/uploads', UploadsRoutes.routes);
    router.use('/api/v1/me', MeRoutes.routes);

    // RF-01: alta, edicion y habilitacion/deshabilitacion de vendedores.
    router.use(
      '/api/v1/sellers',
      requireAuth,
      requireRole(ROLES.ADMIN),
      SellersRoutes.routes
    );

    // RF-02: customer profile, sales history and outstanding credit.
    // TODO: mount with requireAuth + requireRole(ROLES.ADMIN) once the auth
    // middleware changes on the other branch land here (currently unstable).
    router.use('/api/v1/customers', CustomersRoutes.routes);

    // router.use('/api/v1/goals', requireAuth, requireRole(ROLES.ADMIN), GoalsRoutes.routes);

    return router;
  }
}
