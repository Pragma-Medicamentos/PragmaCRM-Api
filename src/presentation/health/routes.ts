import { Router } from 'express';
import { HealthController } from './health.controller';

export class HealthRoutes {
  static get routes(): Router {
    const router = Router();
    const controller = new HealthController();

    router.get('/', controller.getStatus);

    return router;
  }
}
