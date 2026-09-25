import request from 'supertest';
import { AppRoutes } from '../../routes';
import { Server } from '../../server';
import { envs } from '../../../config/envs';
import { ROLES } from '../../../domain/types/auth.types';
import {
  establishSession,
  refreshEstablishedSession,
} from '../../../use-cases/establish-session.use-case';
import { revokeSession } from '../../../services/supabaseSession.service';
import { CustomError } from '../../../domain/errors/CustomError';
import { verifyAccessToken } from '../../../lib/supabaseJwt';
import { findUserByAuthUserId } from '../../../services/auth.service';
import { setUserPassword } from '../../../use-cases/set-password.use-case';

jest.mock('../../../lib/supabaseJwt', () => ({
  verifyAccessToken: jest.fn(),
  JwksUnavailableError: class extends Error {},
  warmUpJwks: jest.fn(),
}));

jest.mock('../../../services/auth.service', () => ({
  findUserByAuthUserId: jest.fn(),
  findActiveUserByEmail: jest.fn(),
}));

jest.mock('../../../use-cases/establish-session.use-case', () => ({
  establishSession: jest.fn(),
  refreshEstablishedSession: jest.fn(),
}));

jest.mock('../../../services/supabaseSession.service', () => ({
  revokeSession: jest.fn(),
}));

jest.mock('../../../use-cases/set-password.use-case', () => ({
  setUserPassword: jest.fn(),
}));

const establishSessionMock = establishSession as jest.Mock;
const refreshEstablishedSessionMock = refreshEstablishedSession as jest.Mock;
const revokeSessionMock = revokeSession as jest.Mock;
const verifyAccessTokenMock = verifyAccessToken as jest.Mock;
const findUserByAuthUserIdMock = findUserByAuthUserId as jest.Mock;
const setUserPasswordMock = setUserPassword as jest.Mock;

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

const API_KEY = envs.API_KEY;

const session = {
  accessToken: 'access-jwt',
  refreshToken: 'refresh-opaque',
  expiresIn: 3600,
  user: {
    id: '11111111-1111-1111-1111-111111111111',
    authUserId: '22222222-2222-2222-2222-222222222222',
    role: ROLES.ADMIN,
    name: 'Admin',
    email: 'admin@pragma.test',
    passwordSetAt: null,
  },
};

const cookieHeader = (res: request.Response): string => {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.join('\n');
};

describe('POST /api/v1/auth/login', () => {
  it('sets HttpOnly session cookies and omits the tokens from the body', async () => {
    establishSessionMock.mockResolvedValue(session);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('x-api-key', API_KEY)
      .set('Origin', 'http://localhost:5173')
      .send({ email: 'admin@pragma.test', password: 'secret' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('admin@pragma.test');
    expect(res.body.data.expiresIn).toBe(3600);
    expect(JSON.stringify(res.body)).not.toContain('access-jwt');
    expect(JSON.stringify(res.body)).not.toContain('refresh-opaque');

    const cookies = cookieHeader(res);
    expect(cookies).toContain('pcrm_access=access-jwt');
    expect(cookies).toContain('pcrm_refresh=refresh-opaque');
    expect(cookies).toContain('HttpOnly');
    expect(cookies).toMatch(/pcrm_access=[^;]*;[^]*Path=\/api\/v1/);
    expect(cookies).toContain('Path=/api/v1/auth');
    expect(cookies.toLowerCase()).not.toContain('samesite=none');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173'
    );
  });

  it('opens a session from { email, otp }', async () => {
    establishSessionMock.mockResolvedValue(session);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('x-api-key', API_KEY)
      .send({ email: 'admin@pragma.test', otp: '123456' });

    expect(res.status).toBe(200);
    expect(establishSessionMock).toHaveBeenCalledWith(expect.anything(), {
      email: 'admin@pragma.test',
      otp: '123456',
    });
    expect(JSON.stringify(res.body)).not.toContain('access-jwt');
    expect(JSON.stringify(res.body)).not.toContain('refresh-opaque');
  });

  it('rejects a body that sends password and otp together', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('x-api-key', API_KEY)
      .send({ email: 'admin@pragma.test', password: 'secret', otp: '123456' });

    expect(res.status).toBe(400);
    expect(establishSessionMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/auth/password', () => {
  const passwordSetAt = '2026-09-25T15:00:00.000Z';

  it('answers 401 without a cookie or bearer token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/password')
      .set('x-api-key', API_KEY)
      .send({ password: 'new-secret' });

    expect(res.status).toBe(401);
    expect(setUserPasswordMock).not.toHaveBeenCalled();
  });

  it('sets the password for a cookie session and does not return tokens', async () => {
    verifyAccessTokenMock.mockResolvedValue({ sub: session.user.authUserId });
    findUserByAuthUserIdMock.mockResolvedValue({
      id: session.user.id,
      auth_user_id: session.user.authUserId,
      role: ROLES.ADMIN,
      name: 'Admin',
      email: 'admin@pragma.test',
      active: true,
      password_set_at: null,
    });
    setUserPasswordMock.mockResolvedValue({
      ...session.user,
      passwordSetAt,
    });

    const res = await request(app)
      .post('/api/v1/auth/password')
      .set('x-api-key', API_KEY)
      .set('Cookie', 'pcrm_access=leaked-access-token; pcrm_refresh=leaked-refresh-token')
      .send({ password: 'new-secret' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: 'Password set',
      data: {
        user: { ...session.user, passwordSetAt },
      },
    });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('leaked-access-token');
    expect(body).not.toContain('leaked-refresh-token');
    expect(body).not.toContain('new-secret');
    expect(body).not.toContain('access_token');
    expect(body).not.toContain('refresh_token');
  });
});

describe('POST /api/v1/auth/refresh', () => {
  it('rotates the cookies from the refresh cookie', async () => {
    refreshEstablishedSessionMock.mockResolvedValue({
      ...session,
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
    });

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('x-api-key', API_KEY)
      .set('Cookie', 'pcrm_refresh=refresh-opaque');

    expect(res.status).toBe(200);
    expect(refreshEstablishedSessionMock).toHaveBeenCalledWith(
      expect.anything(),
      'refresh-opaque'
    );
    const cookies = cookieHeader(res);
    expect(cookies).toContain('pcrm_access=access-2');
    expect(cookies).toContain('pcrm_refresh=refresh-2');
    expect(JSON.stringify(res.body)).not.toContain('access-2');
  });

  it('clears cookies and answers 401 when the refresh cookie is missing', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('x-api-key', API_KEY);

    expect(res.status).toBe(401);
    const cookies = cookieHeader(res);
    expect(cookies).toContain('pcrm_access=;');
    expect(cookies).toContain('pcrm_refresh=;');
    expect(refreshEstablishedSessionMock).not.toHaveBeenCalled();
  });

  it('clears cookies when the refresh token is rejected', async () => {
    refreshEstablishedSessionMock.mockRejectedValue(
      CustomError.unauthorized('Invalid or expired session')
    );

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('x-api-key', API_KEY)
      .set('Cookie', 'pcrm_refresh=dead');

    expect(res.status).toBe(401);
    expect(cookieHeader(res)).toContain('pcrm_refresh=;');
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('clears both cookies and revokes the access token', async () => {
    revokeSessionMock.mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('x-api-key', API_KEY)
      .set('Cookie', 'pcrm_access=access-jwt; pcrm_refresh=refresh-opaque');

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Signed out');
    expect(revokeSessionMock).toHaveBeenCalledWith('access-jwt');
    const cookies = cookieHeader(res);
    expect(cookies).toContain('pcrm_access=;');
    expect(cookies).toContain('pcrm_refresh=;');
    expect(cookies).toContain('Path=/api/v1/auth');
  });

  it('still clears cookies when there is no session', async () => {
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('x-api-key', API_KEY);

    expect(res.status).toBe(200);
    expect(revokeSessionMock).not.toHaveBeenCalled();
    expect(cookieHeader(res)).toContain('pcrm_access=;');
  });
});
