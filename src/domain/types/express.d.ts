import { AuthenticatedUser } from './auth.types';

// Opcional en el tipo porque en rutas publicas no existe; tras requireAuth, si.
declare global {
  namespace Express {
    interface Request {
      authUser?: AuthenticatedUser;
    }
  }
}

export {};
