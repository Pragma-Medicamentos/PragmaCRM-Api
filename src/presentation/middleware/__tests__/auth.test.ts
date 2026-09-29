import request from 'supertest';
import { Router } from 'express';
import { Server } from '../../server';
import { requireAuth, requireRole } from '../auth';
import {
  JwksUnavailableError,
  verifyAccessToken,
} from '../../../lib/supabaseJwt';
import {
  findUserByAuthUserId,
  AppUserRecord,
} from '../../../services/auth.service';
import { ROLES } from '../../../domain/types/auth.types';
import { CustomError } from '../../../domain/errors/CustomError';

// What is under test is the translation session -> user -> role, not the
// cryptography: that belongs to the supabaseJwt unit test, which signs real
// tokens.
jest.mock('../../../lib/supabaseJwt', () => {
  class FakeJwksUnavailableError extends Error {}
  return {
    verifyAccessToken: jest.fn(),
    JwksUnavailableError: FakeJwksUnavailableError,
    warmUpJwks: jest.fn(),
  };
});

jest.mock('../../../services/auth.service', () => ({
  findUserByAuthUserId: jest.fn(),
}));

const verifyAccessTokenMock = verifyAccessToken as jest.Mock;
const findUserByAuthUserIdMock = findUserByAuthUserId as jest.Mock;

const AUTH_ID = '33333333-3333-3333-3333-333333333333';
const BEARER = 'Bearer token-de-prueba';

const validToken = (sub = AUTH_ID) =>
  verifyAccessTokenMock.mockResolvedValue({ sub });

const rejectedToken = () =>
  verifyAccessTokenMock.mockRejectedValue(
    CustomError.unauthorized('Sesión no válida o ausente')
  );

const appUser = (overrides: Partial<AppUserRecord> = {}): AppUserRecord => ({
  id: '11111111-1111-1111-1111-111111111111',
  auth_user_id: AUTH_ID,
  role: ROLES.SELLER,
  name: 'Vendedor de prueba',
  email: 'vendedor@pragma.test',
  active: true,
  password_set_at: null,
  ...overrides,
});

// Server rather than a bare express() so the responses go through the global
// error handler and the real ApiResponse envelope is asserted.
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
  it('acepta el JWT de la cookie pcrm_access cuando no hay Bearer', async () => {
    validToken();
    findUserByAuthUserIdMock.mockResolvedValue(appUser());

    const res = await request(app)
      .get('/api/test/auth')
      .set('Cookie', 'pcrm_access=token-de-cookie');

    expect(res.status).toBe(200);
    expect(verifyAccessTokenMock).toHaveBeenCalledWith('token-de-cookie');
  });

  it('el header Authorization gana sobre la cookie', async () => {
    validToken();
    findUserByAuthUserIdMock.mockResolvedValue(appUser());

    const res = await request(app)
      .get('/api/test/auth')
      .set('Authorization', BEARER)
      .set('Cookie', 'pcrm_access=token-de-cookie');

    expect(res.status).toBe(200);
    expect(verifyAccessTokenMock).toHaveBeenCalledWith('token-de-prueba');
  });

  it('responde 401 cuando no hay header Authorization', async () => {
    const res = await request(app).get('/api/test/auth');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      success: false,
      message: 'Sesión no válida o ausente',
    });
    expect(verifyAccessTokenMock).not.toHaveBeenCalled();
  });

  it('responde 401 cuando el esquema del header no es Bearer', async () => {
    const res = await request(app)
      .get('/api/test/auth')
      .set('Authorization', 'Basic dXNlcjpwYXNz');

    expect(res.status).toBe(401);
    expect(verifyAccessTokenMock).not.toHaveBeenCalled();
  });

  it('responde 401 cuando el token no verifica', async () => {
    rejectedToken();

    const res = await request(app)
      .get('/api/test/auth')
      .set('Authorization', BEARER);

    expect(res.status).toBe(401);
    expect(findUserByAuthUserIdMock).not.toHaveBeenCalled();
  });

  it('responde 503, y no 401, cuando el JWKS no está disponible', async () => {
    verifyAccessTokenMock.mockRejectedValue(
      new JwksUnavailableError('sin red')
    );

    const res = await request(app)
      .get('/api/test/auth')
      .set('Authorization', BEARER);

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
  });

  it('responde 403 cuando el auth_user_id no está enlazado a app_user', async () => {
    validToken();
    findUserByAuthUserIdMock.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/test/auth')
      .set('Authorization', BEARER);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('El usuario no está registrado en el CRM');
  });

  it('responde 403 cuando el usuario está deshabilitado', async () => {
    validToken();
    findUserByAuthUserIdMock.mockResolvedValue(appUser({ active: false }));

    const res = await request(app)
      .get('/api/test/auth')
      .set('Authorization', BEARER);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('El usuario está deshabilitado');
  });

  it('responde 403 cuando el role de la base está fuera del dominio', async () => {
    validToken();
    findUserByAuthUserIdMock.mockResolvedValue(appUser({ role: 'Supervisor' }));

    const res = await request(app)
      .get('/api/test/auth')
      .set('Authorization', BEARER);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('El usuario no tiene un rol válido');
  });

  it('resuelve el usuario contra el claim sub y lo expone en req.authUser', async () => {
    const otherId = '44444444-4444-4444-4444-444444444444';
    validToken(otherId);
    findUserByAuthUserIdMock.mockResolvedValue(
      appUser({ auth_user_id: otherId })
    );

    const res = await request(app)
      .get('/api/test/auth')
      .set('Authorization', BEARER);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      id: '11111111-1111-1111-1111-111111111111',
      authUserId: otherId,
      role: ROLES.SELLER,
      name: 'Vendedor de prueba',
      email: 'vendedor@pragma.test',
      passwordSetAt: null,
    });
    expect(findUserByAuthUserIdMock).toHaveBeenCalledWith(
      expect.anything(),
      otherId
    );
  });
});

describe('requireRole', () => {
  it('responde 403 cuando el rol no está en la lista permitida', async () => {
    validToken();
    findUserByAuthUserIdMock.mockResolvedValue(appUser({ role: ROLES.SELLER }));

    const res = await request(app)
      .get('/api/test/admin')
      .set('Authorization', BEARER);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      success: false,
      message: 'Acceso denegado para este rol',
    });
  });

  it('deja pasar cuando el rol está permitido', async () => {
    validToken();
    findUserByAuthUserIdMock.mockResolvedValue(appUser({ role: ROLES.ADMIN }));

    const res = await request(app)
      .get('/api/test/admin')
      .set('Authorization', BEARER);

    expect(res.status).toBe(200);
  });

  it('responde 401 si se monta sin requireAuth delante', async () => {
    validToken();

    const res = await request(app)
      .get('/api/test/sin-require-auth')
      .set('Authorization', BEARER);

    expect(res.status).toBe(401);
  });
});
