import { Router } from 'express';
import { HealthRoutes } from './health/routes';
import { UploadsRoutes } from './uploads/routes';
import { MeRoutes } from './me/routes';
import { AuthRoutes } from './auth/routes';
import { SellersRoutes } from './sellers/routes';
import { CustomersRoutes } from './customers/routes';
import { ProductsRoutes } from './products/routes';
import { DailyRouteRoutes } from './daily-route/routes';
import { RoutesRoutes } from './routes/routes';
import { VisitsRoutes } from './visits/routes';
import { MetricsRoutes } from './metrics/routes';
import { ProspectsRoutes } from './prospects/routes';
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

    // Must stay after the '/api/v1/me' mount above: MeRoutes only declares
    // GET '/', so '/api/v1/me/route' falls through to this router today, but
    // any future GET '/:param' added to MeRoutes would shadow it first.
    //
    // Note it does not collide with the admin '/api/v1/routes' module mounted
    // below: that one is RF-04 (building routes), this one is the seller's
    // own agenda for a date, which is why it hangs off '/me'.
    router.use(
      '/api/v1/me/route',
      requireAuth,
      requireRole(ROLES.SELLER),
      DailyRouteRoutes.routes
    );

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

    // Read-only product catalog, fed by the Efactsoft import. No write route.
    router.use(
      '/api/v1/products',
      requireAuth,
      requireRole(ROLES.ADMIN),
      ProductsRoutes.routes
    );

    // RF-04: creating routes and assigning/reassigning them to vendors.
    router.use(
      '/api/v1/routes',
      requireAuth,
      requireRole(ROLES.ADMIN),
      RoutesRoutes.routes
    );

    // RF-06: stop confirmation with GPS. Only the Vendedor executes stops.
    router.use(
      '/api/v1/visits',
      requireAuth,
      requireRole(ROLES.SELLER),
      VisitsRoutes.routes
    );

    // RF-09: base metrics panel. Admin only: it aggregates the whole team's
    // sales and field activity.
    router.use(
      '/api/v1/metrics',
      requireAuth,
      requireRole(ROLES.ADMIN),
      MetricsRoutes.routes
    );
    // PCRM-62: prospects. Auth here; role per verb inside ProspectsRoutes
    // (SELLER POST, ADMIN GET) so PCRM-64 can list without a second mount.
    router.use('/api/v1/prospects', requireAuth, ProspectsRoutes.routes);

    // router.use('/api/v1/goals', requireAuth, requireRole(ROLES.ADMIN), GoalsRoutes.routes);

    return router;
  }
}
