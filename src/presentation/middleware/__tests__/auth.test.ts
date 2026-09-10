import request from 'supertest';
import { Router } from 'express';
import { getAuth } from '@clerk/express';
import { Server } from '../../server';
import { requireAuth, requireRole } from '../auth';
import { findUserByClerkId, AppUserRecord } from '../../../services/auth.service';
import { ROLES } from '../../../domain/types/auth.types';

// Se mockea el SDK: lo que se prueba es la traduccion sesion -> usuario -> rol.
jest.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  getAuth: jest.fn(),
}));

jest.mock('../../../services/auth.service', () => ({
  findUserByClerkId: jest.fn(),
}));

const getAuthMock = getAuth as unknown as jest.Mock;
const findUserByClerkIdMock = findUserByClerkId as jest.Mock;

const signedIn = (userId = 'user_clerk_123') =>
  getAuthMock.mockReturnValue({ isAuthenticated: true, userId });

const signedOut = () =>
  getAuthMock.mockReturnValue({ isAuthenticated: false, userId: null });

const appUser = (overrides: Partial<AppUserRecord> = {}): AppUserRecord => ({
  id: '11111111-1111-1111-1111-111111111111',
  clerk_user_id: 'user_clerk_123',
  role: ROLES.SELLER,
  name: 'Vendedor de prueba',
  email: 'vendedor@pragma.test',
  active: true,
  ...overrides,
});

// Se usa Server y no un express() suelto para que las respuestas pasen por el
// error handler global y se verifique el envelope ApiResponse real.
const buildApp = () => {
  const router = Router();
  router.get('/api/test/auth', requireAuth, (req, res) => {
    res.status(200).json({ success: true, message: 'ok', data: req.authUser });
  });
  router.get(
    '/api/test/admin',
    requireAuth,
    requireRole(ROLES.ADMIN),
    (_req, res) => {
      res.status(200).json({ success: true, message: 'ok' });
    }
  );
  router.get('/api/test/sin-require-auth', requireRole(ROLES.ADMIN), (_req, res) => {
    res.status(200).json({ success: true, message: 'ok' });
  });

  const server = new Server({ port: 0, routes: router });
  server.setup();
  return server.app;
};

const app = buildApp();

describe('requireAuth', () => {
  it('responde 401 cuando no hay sesión válida de Clerk', async () => {
    signedOut();

    const res = await request(app).get('/api/test/auth');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      success: false,
      message: 'Sesión no válida o ausente',
    });
    expect(findUserByClerkIdMock).not.toHaveBeenCalled();
  });

  it('responde 403 cuando el clerk_user_id no está enlazado a app_user', async () => {
    signedIn();
    findUserByClerkIdMock.mockResolvedValue(null);

    const res = await request(app).get('/api/test/auth');

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('El usuario no está registrado en el CRM');
  });

  it('responde 403 cuando el usuario está deshabilitado', async () => {
    signedIn();
    findUserByClerkIdMock.mockResolvedValue(appUser({ active: false }));

    const res = await request(app).get('/api/test/auth');

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('El usuario está deshabilitado');
  });

  it('responde 403 cuando el role de la base está fuera del dominio', async () => {
    signedIn();
    findUserByClerkIdMock.mockResolvedValue(appUser({ role: 'Supervisor' }));

    const res = await request(app).get('/api/test/auth');

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('El usuario no tiene un rol válido');
  });

  it('resuelve el usuario contra el claim sub y lo expone en req.authUser', async () => {
    signedIn('user_clerk_abc');
    findUserByClerkIdMock.mockResolvedValue(
      appUser({ clerk_user_id: 'user_clerk_abc' })
    );

    const res = await request(app).get('/api/test/auth');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      id: '11111111-1111-1111-1111-111111111111',
      clerkUserId: 'user_clerk_abc',
      role: ROLES.SELLER,
      name: 'Vendedor de prueba',
      email: 'vendedor@pragma.test',
    });
    expect(findUserByClerkIdMock).toHaveBeenCalledWith(
      expect.anything(),
      'user_clerk_abc'
    );
  });
});

describe('requireRole', () => {
  it('responde 403 cuando el rol no está en la lista permitida', async () => {
    signedIn();
    findUserByClerkIdMock.mockResolvedValue(appUser({ role: ROLES.SELLER }));

    const res = await request(app).get('/api/test/admin');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      success: false,
      message: 'Acceso denegado para este rol',
    });
  });

  it('deja pasar cuando el rol está permitido', async () => {
    signedIn();
    findUserByClerkIdMock.mockResolvedValue(appUser({ role: ROLES.ADMIN }));

    const res = await request(app).get('/api/test/admin');

    expect(res.status).toBe(200);
  });

  it('responde 401 si se monta sin requireAuth delante', async () => {
    signedIn();

    const res = await request(app).get('/api/test/sin-require-auth');

    expect(res.status).toBe(401);
  });
});
