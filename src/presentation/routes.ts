import { Router } from 'express';
import { HealthRoutes } from './health/routes';
import { UploadsRoutes } from './uploads/routes';
import { MeRoutes } from './me/routes';
import { AuthRoutes } from './auth/routes';
import { SellersRoutes } from './sellers/routes';
import { CustomersRoutes } from './customers/routes';
import { RoutesRoutes } from './routes/routes';
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

    // RF-02: customer profile, sales history, outstanding credit and GPS pin.
    // Solo el Administrador: la ficha de cliente expone datos comerciales y
    // de credito que un Vendedor no debe ver en el dashboard.
    router.use(
      '/api/v1/customers',
      requireAuth,
      requireRole(ROLES.ADMIN),
      CustomersRoutes.routes
    );

    // RF-04: creating routes and assigning/reassigning them to vendors.
    router.use(
      '/api/v1/routes',
      requireAuth,
      requireRole(ROLES.ADMIN),
      RoutesRoutes.routes
    );

    // router.use('/api/v1/goals', requireAuth, requireRole(ROLES.ADMIN), GoalsRoutes.routes);

    return router;
  }
}
