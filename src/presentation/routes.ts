import { Router } from 'express';
import { HealthRoutes } from './health/routes';

export class AppRoutes {
  static get routes(): Router {
    const router = Router();

    router.use('/api/health', HealthRoutes.routes);

    // Los modulos del CRM se montan aqui bajo /api/v1/<recurso>.
    // router.use('/api/v1/clientes', ClientesRoutes.routes);

    return router;
  }
}
