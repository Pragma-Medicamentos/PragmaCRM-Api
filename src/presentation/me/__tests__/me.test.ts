import request from 'supertest';
import { verifyAccessToken } from '../../../lib/supabaseJwt';
import { AppRoutes } from '../../routes';
import { Server } from '../../server';
import { envs } from '../../../config/envs';
import { findUserByAuthUserId } from '../../../services/auth.service';
import { ROLES } from '../../../domain/types/auth.types';

jest.mock('../../../lib/supabaseJwt', () => ({
  verifyAccessToken: jest.fn(),
  JwksUnavailableError: class extends Error {},
  warmUpJwks: jest.fn(),
}));

jest.mock('../../../services/auth.service', () => ({
  findUserByAuthUserId: jest.fn(),
  findActiveUserByEmail: jest.fn(),
}));

const verifyAccessTokenMock = verifyAccessToken as unknown as jest.Mock;
const findUserByAuthUserIdMock = findUserByAuthUserId as jest.Mock;

const AUTH_ID = '55555555-5555-5555-5555-555555555555';
const PASSWORD_SET_AT = '2026-09-11T12:00:00.000Z';

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

const API_KEY = envs.API_KEY;

describe('GET /api/v1/me', () => {
  it('devuelve usuario, rol y passwordSetAt para una sesion valida', async () => {
    verifyAccessTokenMock.mockResolvedValue({ sub: AUTH_ID });
    findUserByAuthUserIdMock.mockResolvedValue({
      id: '22222222-2222-2222-2222-222222222222',
      auth_user_id: AUTH_ID,
      role: ROLES.ADMIN,
      name: 'Admin de prueba',
      email: 'admin@pragma.test',
      active: true,
      password_set_at: new Date(PASSWORD_SET_AT),
    });

    const res = await request(app)
      .get('/api/v1/me')
      .set('Authorization', 'Bearer token-de-prueba')
.set('x-api-key', API_KEY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: 'Sesión válida',
      data: {
        id: '22222222-2222-2222-2222-222222222222',
        authUserId: AUTH_ID,
        role: ROLES.ADMIN,
        name: 'Admin de prueba',
        email: 'admin@pragma.test',
        passwordSetAt: PASSWORD_SET_AT,
      },
    });
  });

  it('expone passwordSetAt null cuando aun no hay contrasena', async () => {
    verifyAccessTokenMock.mockResolvedValue({ sub: AUTH_ID });
    findUserByAuthUserIdMock.mockResolvedValue({
      id: '22222222-2222-2222-2222-222222222222',
      auth_user_id: AUTH_ID,
      role: ROLES.SELLER,
      name: 'Vendedor de prueba',
      email: 'vendedor@pragma.test',
      active: true,
      password_set_at: null,
    });

    const res = await request(app)
      .get('/api/v1/me')
      .set('Authorization', 'Bearer token-de-prueba')
.set('x-api-key', API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data.passwordSetAt).toBeNull();
  });

  it('responde 401 sin token', async () => {
    const res = await request(app).get('/api/v1/me').set('x-api-key', API_KEY);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/health', () => {
  it('sigue siendo publica sin token', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
  });
});
