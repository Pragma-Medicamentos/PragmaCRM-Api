import { NextFunction, Request, Response } from 'express';
import {
  JwksUnavailableError,
  verifyAccessToken,
} from '../../lib/supabaseJwt';
import { CustomError } from '../../domain/errors/CustomError';
import { AuthenticatedUser, Role, isRole } from '../../domain/types/auth.types';
import { readAccessCookie } from '../../lib/authCookies';
import { findUserByAuthUserId } from '../../services/auth.service';
import { logger } from '../../lib/adapters/logger';
import { prisma } from '../../lib/prisma';

const logRejection = (
  req: Request,
  res: Response,
  reason: string,
  data: Record<string, unknown> = {}
): void => {
  logger.warn('Access denied', {
    method: req.method,
    path: req.originalUrl.split('?')[0],
    reason,
    request_id: res.getHeader('X-Request-ID'),
    ...data,
  });
};

const bearerToken = (req: Request): string | undefined => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;

  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : undefined;
};

// 401 solo si no se sabe quien es. Todo lo demas es 403: volver a loguearse no lo arregla.
export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Bearer wins so the Android client (and any existing caller) is unchanged
    // when it sends Authorization. The cookie is the web session (PCRM-109).
    const token = bearerToken(req) ?? readAccessCookie(req);

    if (!token) {
      logRejection(req, res, 'missing_or_invalid_token');
      throw CustomError.unauthorized('Sesión no válida o ausente');
    }

    const claims = await verifyAccessToken(token).catch((error: unknown) => {
      // A JWKS outage says nothing about the token: answering 401 would send
      // every user back to the login screen over a network problem.
      if (error instanceof JwksUnavailableError) {
        logRejection(req, res, 'jwks_unavailable');
        throw new CustomError('Servicio de autenticación no disponible', 503);
      }
      logRejection(req, res, 'missing_or_invalid_token');
      throw error;
    });

    const record = await findUserByAuthUserId(prisma, claims.sub);

    if (!record) {
      logRejection(req, res, 'user_not_linked', { auth_user_id: claims.sub });
      throw CustomError.forbidden('El usuario no está registrado en el CRM');
    }

    if (!record.active) {
      logRejection(req, res, 'user_disabled', { user_id: record.id });
      throw CustomError.forbidden('El usuario está deshabilitado');
    }

    // app_user.role es text libre: un valor fuera del dominio es dato corrupto.
    if (!isRole(record.role)) {
      logRejection(req, res, 'unknown_role', {
        user_id: record.id,
        role: record.role,
      });
      throw CustomError.forbidden('El usuario no tiene un rol válido');
    }

    const authUser: AuthenticatedUser = {
      id: record.id,
      authUserId: claims.sub,
      role: record.role,
      name: record.name,
      email: record.email,
      passwordSetAt: record.password_set_at?.toISOString() ?? null,
    };

    req.authUser = authUser;
    next();
  } catch (error) {
    next(error);
  }
};

export const requireRole =
  (...allowed: Role[]) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const authUser = req.authUser;

    // Solo pasa si se monto requireRole sin requireAuth delante: bug de rutas.
    if (!authUser) {
      logger.error('requireRole used without requireAuth', {
        path: req.originalUrl.split('?')[0],
      });
      return next(CustomError.unauthorized('Sesión no válida o ausente'));
    }

    if (!allowed.includes(authUser.role)) {
      logRejection(req, res, 'insufficient_role', {
        user_id: authUser.id,
        role: authUser.role,
        allowed,
      });
      return next(CustomError.forbidden('Acceso denegado para este rol'));
    }

    next();
  };
