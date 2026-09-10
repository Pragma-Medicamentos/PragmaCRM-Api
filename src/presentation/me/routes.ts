import { Router } from 'express';
import { MeController } from './me.controller';
import { requireAuth } from '../middleware/auth';

export class MeRoutes {
  static get routes(): Router {
    const router = Router();
    const controller = new MeController();

    // Sin requireRole: es el endpoint con el que cada cliente descubre su rol.
    router.get('/', requireAuth, controller.getSession);

    return router;
  }
}
