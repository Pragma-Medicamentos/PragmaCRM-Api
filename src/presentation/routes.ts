import { Router } from 'express';
import { HealthRoutes } from './health/routes';
import { UploadsRoutes } from './uploads/routes';
import { MeRoutes } from './me/routes';
import { AuthRoutes } from './auth/routes';
import { SellersRoutes } from './sellers/routes';
import { CustomersRoutes } from './customers/routes';
import { requireAuth, requireRole } from './middleware/auth';
import { requireApiKey } from './middleware/apiKey';
import { ROLES } from '../domain/types/auth.types';

export class AppRoutes {
  static get routes(): Router {
    const router = Router();

    // Publica: la consume el monitoreo del VPS.
    router.use('/api/health', HealthRoutes.routes);

    // Transport-level gate: every request to the CRM (everything except
    // /api/health, mounted above) must present the static x-api-key from the
    // environment. Runs before any route group so a caller without the key is
    // rejected before hitting body parsers, multer or other middlewares.
    router.use(requireApiKey);

    // CRM modules are mounted here under /api/v1/<resource>.
    // RF-03: solo el Administrador puede importar el JSON del ERP.
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

    // RF-02: customer profile, sales history and outstanding credit.
    // TODO: mount with requireAuth + requireRole(ROLES.ADMIN) once the auth
    // middleware changes on the other branch land here (currently unstable).
    router.use('/api/v1/customers', CustomersRoutes.routes);

    // router.use('/api/v1/goals', requireAuth, requireRole(ROLES.ADMIN), GoalsRoutes.routes);

    return router;
  }
}
