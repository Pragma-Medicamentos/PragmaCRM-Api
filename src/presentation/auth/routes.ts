import { Router } from 'express';
import { AuthController } from './auth.controller';
import { validateBody } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import {
  loginSchema,
  requestOtpSchema,
  setPasswordSchema,
} from '../../domain/schemas/auth.schema';

export class AuthRoutes {
  static get routes(): Router {
    const router = Router();
    const controller = new AuthController();

    router.post('/otp', validateBody(requestOtpSchema), controller.requestOtp);
    router.post('/login', validateBody(loginSchema), controller.login);
    // Cookie or Bearer. Does not issue tokens; the session already exists.
    router.post(
      '/password',
      requireAuth,
      validateBody(setPasswordSchema),
      controller.setPassword
    );
    router.post('/refresh', controller.refresh);
    router.post('/logout', controller.logout);

    return router;
  }
}
