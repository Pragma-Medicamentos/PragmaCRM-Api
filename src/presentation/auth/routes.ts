import { Router } from 'express';
import { AuthController } from './auth.controller';
import { validateBody } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { authRateLimiter } from '../middleware/rateLimit';
import {
  loginSchema,
  requestOtpSchema,
  setPasswordSchema,
} from '../../domain/schemas/auth.schema';

export class AuthRoutes {
  static get routes(): Router {
    const router = Router();
    const controller = new AuthController();

    // Public routes: rate limited per IP before any work is done (PCRM-138).
    router.post(
      '/otp',
      authRateLimiter('otp'),
      validateBody(requestOtpSchema),
      controller.requestOtp
    );
    router.post(
      '/login',
      authRateLimiter('login'),
      validateBody(loginSchema),
      controller.login
    );
    // Cookie or Bearer. Does not issue tokens; the session already exists.
    router.post(
      '/password',
      requireAuth,
      validateBody(setPasswordSchema),
      controller.setPassword
    );
    router.post('/refresh', authRateLimiter('refresh'), controller.refresh);
    router.post('/logout', controller.logout);

    return router;
  }
}
