import request from 'supertest';
import { verifyAccessToken } from '../../../lib/supabaseJwt';
import { AppRoutes } from '../../routes';
import { Server } from '../../server';
import { envs } from '../../../config/envs';
import { findUserByAuthUserId } from '../../../services/auth.service';
import { getRouteHistory } from '../../../services/route-history.service';
import { ROLES } from '../../../domain/types/auth.types';
import { RouteHistory } from '../../../domain/types/route-history.types';

jest.mock('../../../lib/supabaseJwt', () => ({
  verifyAccessToken: jest.fn(),
  JwksUnavailableError: class extends Error {},
  warmUpJwks: jest.fn(),
}));

jest.mock('../../../services/auth.service', () => ({
  findUserByAuthUserId: jest.fn(),
  findActiveUserByEmail: jest.fn(),
}));

jest.mock('../../../services/route-history.service', () => ({
  getRouteHistory: jest.fn(),
}));

const verifyAccessTokenMock = verifyAccessToken as unknown as jest.Mock;
const findUserByAuthUserIdMock = findUserByAuthUserId as jest.Mock;
const getRouteHistoryMock = getRouteHistory as jest.Mock;

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

const history: RouteHistory = {
  days: [
    {
      date: '2026-10-21',
      routes: [
        {
          id: 'a1111111-1111-1111-1111-111111111111',
          route_user_id: 'b2222222-2222-2222-2222-222222222222',
          name: 'Zona Escalón',
          municipality: 'San Salvador',
          zone: 'Escalón',
        },
      ],
      total: 5,
      completed: 4,
      skipped: 1,
      skipped_stops: [
        { id: 'c3333333-3333-3333-3333-333333333333', name: 'Drog. Vida Nueva', stop_type: 'visit' },
      ],
    },
  ],
  next_before: null,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/v1/me/route/history', () => {
  const get = (query = '') =>
    request(app)
      .get(`/api/v1/me/route/history${query}`)
      .set('Authorization', 'Bearer token-de-prueba')
      .set('x-api-key', API_KEY);

  const asSeller = () => {
    verifyAccessTokenMock.mockResolvedValue({ sub: AUTH_ID });
    findUserByAuthUserIdMock.mockResolvedValue(sellerRecord);
  };

  it('devuelve el historial del vendedor autenticado, con el límite por defecto', async () => {
    asSeller();
    getRouteHistoryMock.mockResolvedValue(history);

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: 'Historial de rutas obtenido correctamente',
      data: history,
    });
    expect(getRouteHistoryMock).toHaveBeenCalledWith(expect.anything(), SELLER_ID, {
      before: undefined,
      limit: 20,
    });
  });

  it('pasa before y limit ya validados al service', async () => {
    asSeller();
    getRouteHistoryMock.mockResolvedValue(history);

    const res = await get('?before=2026-10-01&limit=5');

    expect(res.status).toBe(200);
    expect(getRouteHistoryMock).toHaveBeenCalledWith(expect.anything(), SELLER_ID, {
      before: '2026-10-01',
      limit: 5,
    });
  });

  it.each([
    ['un before que no es YYYY-MM-DD', '?before=01-10-2026'],
    ['un limit de 0', '?limit=0'],
    ['un limit sobre el máximo', '?limit=61'],
    ['un limit no entero', '?limit=2.5'],
  ])('responde 400 con %s', async (_label, query) => {
    asSeller();

    const res = await get(query);

    expect(res.status).toBe(400);
    expect(getRouteHistoryMock).not.toHaveBeenCalled();
  });

  it('responde 403 para un Administrador y nunca llama al service', async () => {
    verifyAccessTokenMock.mockResolvedValue({ sub: AUTH_ID });
    findUserByAuthUserIdMock.mockResolvedValue(adminRecord);

    const res = await get();

    expect(res.status).toBe(403);
    expect(getRouteHistoryMock).not.toHaveBeenCalled();
  });

  it('responde 401 sin token y nunca llama al service', async () => {
    const res = await request(app)
      .get('/api/v1/me/route/history')
      .set('x-api-key', API_KEY);

    expect(res.status).toBe(401);
    expect(getRouteHistoryMock).not.toHaveBeenCalled();
  });

  it('responde 500 con el envelope de error si el service falla', async () => {
    asSeller();
    getRouteHistoryMock.mockRejectedValue(new Error('boom'));

    const res = await get();

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});
