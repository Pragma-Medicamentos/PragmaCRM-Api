import { Request, Response } from 'express';
import { ApiResponse } from '../../domain/interfaces';
import {
  LoginInput,
  RequestOtpInput,
  SetPasswordInput,
} from '../../domain/schemas/auth.schema';
import { AuthenticatedUser } from '../../domain/types/auth.types';
import { sendErrorResponse } from '../../lib/sendErrorResponse';
import { prisma } from '../../lib/prisma';
import { requestLoginOtp } from '../../use-cases/request-login-otp.use-case';
import {
  establishSession,
  EstablishedSession,
  refreshEstablishedSession,
} from '../../use-cases/establish-session.use-case';
import {
  clearSessionCookies,
  readAccessCookie,
  readRefreshCookie,
  setSessionCookies,
} from '../../lib/authCookies';
import { logger } from '../../lib/adapters/logger';
import { revokeSession } from '../../services/supabaseSession.service';
import { setUserPassword } from '../../use-cases/set-password.use-case';
import { CustomError } from '../../domain/errors/CustomError';

interface SessionPayload {
  expiresIn: number;
  user: AuthenticatedUser;
}

const sessionPayload = (session: EstablishedSession): SessionPayload => ({
  expiresIn: session.expiresIn,
  user: session.user,
});

export class AuthController {
  public async requestOtp(req: Request, res: Response) {
    try {
      const { email } = req.body as RequestOtpInput;
      await requestLoginOtp(prisma, email);

      const response: ApiResponse = {
        success: true,
        message: 'Codigo enviado al correo. Expira en 10 minutos',
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'AuthController.requestOtp');
    }
  }

  public async login(req: Request, res: Response) {
    try {
      const session = await establishSession(prisma, req.body as LoginInput);
      setSessionCookies(res, session);

      const response: ApiResponse<SessionPayload> = {
        success: true,
        message: 'Signed in',
        data: sessionPayload(session),
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'AuthController.login');
    }
  }

  public async refresh(req: Request, res: Response) {
    try {
      const refreshToken = readRefreshCookie(req);
      if (!refreshToken) {
        clearSessionCookies(res);
        throw CustomError.unauthorized('Invalid or expired session');
      }

      const session = await refreshEstablishedSession(prisma, refreshToken);
      setSessionCookies(res, session);

      const response: ApiResponse<SessionPayload> = {
        success: true,
        message: 'Session refreshed',
        data: sessionPayload(session),
      };
      res.status(200).json(response);
    } catch (error) {
      // A dead refresh cookie must not stay in the browser and retry forever.
      clearSessionCookies(res);
      sendErrorResponse(res, error, 'AuthController.refresh');
    }
  }

  public async setPassword(req: Request, res: Response) {
    try {
      if (!req.authUser) throw CustomError.unauthorized();

      const { password } = req.body as SetPasswordInput;
      const user = await setUserPassword(prisma, req.authUser, password);

      const response: ApiResponse<{ user: AuthenticatedUser }> = {
        success: true,
        message: 'Password set',
        data: { user },
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'AuthController.setPassword');
    }
  }

  public async logout(req: Request, res: Response) {
    try {
      const accessToken = readAccessCookie(req);
      clearSessionCookies(res);

      if (accessToken) {
        await revokeSession(accessToken).catch((error: unknown) => {
          logger.warn('Failed to revoke the Supabase session on logout', {
            error,
          });
        });
      }

      const response: ApiResponse = {
        success: true,
        message: 'Signed out',
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'AuthController.logout');
    }
  }
}
