import request from 'supertest';
import { verifyAccessToken } from '../../../lib/supabaseJwt';
import { AppRoutes } from '../../routes';
import { Server } from '../../server';
import { envs } from '../../../config/envs';
import { findUserByAuthUserId } from '../../../services/auth.service';
import { getWeeklyRoute } from '../../../services/weekly-route.service';
import { ROLES } from '../../../domain/types/auth.types';
import { WeeklyRoute } from '../../../domain/types/weekly-route.types';

jest.mock('../../../lib/supabaseJwt', () => ({
  verifyAccessToken: jest.fn(),
  JwksUnavailableError: class extends Error {},
  warmUpJwks: jest.fn(),
}));

jest.mock('../../../services/auth.service', () => ({
  findUserByAuthUserId: jest.fn(),
  findActiveUserByEmail: jest.fn(),
}));

jest.mock('../../../services/weekly-route.service', () => ({
  getWeeklyRoute: jest.fn(),
}));

const verifyAccessTokenMock = verifyAccessToken as unknown as jest.Mock;
const findUserByAuthUserIdMock = findUserByAuthUserId as jest.Mock;
const getWeeklyRouteMock = getWeeklyRoute as jest.Mock;

const AUTH_ID = '66666666-6666-6666-6666-666666666666';
const SELLER_ID = '33333333-3333-3333-3333-333333333333';

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

const API_KEY = envs.API_KEY;

const sellerRecord = {
  id: SELLER_ID,
  auth_user_id: AUTH_ID,
  role: ROLES.SELLER,
  name: 'Vendedor de prueba',
  email: 'vendedor@pragma.test',
  active: true,
  password_set_at: new Date('2026-09-11T12:00:00.000Z'),
};

const adminRecord = {
  ...sellerRecord,
  id: '44444444-4444-4444-4444-444444444444',
  role: ROLES.ADMIN,
};

const week: WeeklyRoute = {
  week_start: '2026-10-12',
  week_end: '2026-10-18',
  today: '2026-10-14',
  days: [1, 2, 3, 4, 5, 6, 7].map((day) => ({
    day,
    date: `2026-10-${11 + day}`,
    routes: [],
    stops: [],
  })),
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/v1/me/route/week', () => {
  it('devuelve la semana asignada del vendedor autenticado', async () => {
    verifyAccessTokenMock.mockResolvedValue({ sub: AUTH_ID });
    findUserByAuthUserIdMock.mockResolvedValue(sellerRecord);
    getWeeklyRouteMock.mockResolvedValue(week);

    const res = await request(app)
      .get('/api/v1/me/route/week')
      .set('Authorization', 'Bearer token-de-prueba')
      .set('x-api-key', API_KEY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: 'Ruta semanal obtenida correctamente',
      data: week,
    });
    // The seller comes from the token, and the week from the service default.
    expect(getWeeklyRouteMock).toHaveBeenCalledWith(expect.anything(), SELLER_ID);
  });

  it('responde 403 para un Administrador y nunca llama al service', async () => {
    verifyAccessTokenMock.mockResolvedValue({ sub: AUTH_ID });
    findUserByAuthUserIdMock.mockResolvedValue(adminRecord);

    const res = await request(app)
      .get('/api/v1/me/route/week')
      .set('Authorization', 'Bearer token-de-prueba')
      .set('x-api-key', API_KEY);

    expect(res.status).toBe(403);
    expect(getWeeklyRouteMock).not.toHaveBeenCalled();
  });

  it('responde 401 sin token y nunca llama al service', async () => {
    const res = await request(app)
      .get('/api/v1/me/route/week')
      .set('x-api-key', API_KEY);

    expect(res.status).toBe(401);
    expect(getWeeklyRouteMock).not.toHaveBeenCalled();
  });

  it('responde 500 con el envelope de error si el service falla', async () => {
    verifyAccessTokenMock.mockResolvedValue({ sub: AUTH_ID });
    findUserByAuthUserIdMock.mockResolvedValue(sellerRecord);
    getWeeklyRouteMock.mockRejectedValue(new Error('boom'));

    const res = await request(app)
      .get('/api/v1/me/route/week')
      .set('Authorization', 'Bearer token-de-prueba')
      .set('x-api-key', API_KEY);

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});
