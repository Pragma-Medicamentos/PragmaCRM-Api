import { NextFunction, Request, Response } from 'express';
import { getAuth } from '@clerk/express';
import { CustomError } from '../../domain/errors/CustomError';
import { AuthenticatedUser, Role, isRole } from '../../domain/types/auth.types';
import { findUserByClerkId } from '../../services/auth.service';
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

// 401 solo si no se sabe quien es. Todo lo demas es 403: volver a loguearse no lo arregla.
export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const auth = getAuth(req);

    if (!auth.isAuthenticated || !auth.userId) {
      logRejection(req, res, 'missing_or_invalid_token');
      throw CustomError.unauthorized('Sesión no válida o ausente');
    }

    const record = await findUserByClerkId(prisma, auth.userId);

    if (!record) {
      logRejection(req, res, 'user_not_linked', { clerk_user_id: auth.userId });
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
      clerkUserId: auth.userId,
      role: record.role,
      name: record.name,
      email: record.email,
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
