import request from 'supertest';
import { verifyAccessToken } from '../../../lib/supabaseJwt';
import { AppRoutes } from '../../routes';
import { Server } from '../../server';
import { envs } from '../../../config/envs';
import { findUserByAuthUserId } from '../../../services/auth.service';
import {
  getDailyRoute,
  setStopCustomerLocation,
} from '../../../services/daily-route.service';
import { CustomError } from '../../../domain/errors/CustomError';
import { ROLES } from '../../../domain/types/auth.types';
import { DailyRoute } from '../../../domain/types/daily-route.types';

jest.mock('../../../lib/supabaseJwt', () => ({
  verifyAccessToken: jest.fn(),
  JwksUnavailableError: class extends Error {},
  warmUpJwks: jest.fn(),
}));

jest.mock('../../../services/auth.service', () => ({
  findUserByAuthUserId: jest.fn(),
  findActiveUserByEmail: jest.fn(),
}));

jest.mock('../../../services/daily-route.service', () => ({
  getDailyRoute: jest.fn(),
  setStopCustomerLocation: jest.fn(),
}));

const verifyAccessTokenMock = verifyAccessToken as unknown as jest.Mock;
const findUserByAuthUserIdMock = findUserByAuthUserId as jest.Mock;
const getDailyRouteMock = getDailyRoute as jest.Mock;
const setStopCustomerLocationMock = setStopCustomerLocation as jest.Mock;

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
  name: 'Admin de prueba',
  email: 'admin@pragma.test',
};

const nonEmptyRoute: DailyRoute = {
  date: '2026-09-19',
  routes: [
    {
      id: 'a1111111-1111-1111-1111-111111111111',
      route_user_id: 'b2222222-2222-2222-2222-222222222222',
      name: 'Zona Escalón',
      municipality: 'San Salvador',
      zone: 'Escalón',
    },
  ],
  stops: [
    {
      id: 'c3333333-3333-3333-3333-333333333333',
      route: { id: 'a1111111-1111-1111-1111-111111111111', name: 'Zona Escalón' },
      stop_type: 'visit',
      target_kind: 'customer',
      target_id: 'd4444444-4444-4444-4444-444444444444',
      name: 'Farmacia San José',
      trade_name: 'San José',
      address: 'Av. Masferrer #12',
      zone: 'Col. Escalón',
      municipality: 'San Salvador',
      phone: '7788-2233',
      personality: 'verde',
      potential: 'medio',
      establishment_type: 'Farmacia',
      credit_limit: 2500,
      location: { lat: 13.7012, lng: -89.2412 },
      sort_order: 3,
      is_extra: false,
      reason: null,
      completed_at: null,
    },
  ],
};

const emptyRoute: DailyRoute = {
  date: '2026-09-20',
  routes: [],
  stops: [],
};

const asSeller = () => {
  verifyAccessTokenMock.mockResolvedValue({ sub: AUTH_ID });
  findUserByAuthUserIdMock.mockResolvedValue(sellerRecord);
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/v1/me/route', () => {
  it('devuelve la ruta del dia con sus paradas para un vendedor', async () => {
    asSeller();
    getDailyRouteMock.mockResolvedValue(nonEmptyRoute);

    const res = await request(app)
      .get('/api/v1/me/route')
      .set('Authorization', 'Bearer token-de-prueba')
      .set('x-api-key', API_KEY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: 'Ruta del día obtenida correctamente',
      data: nonEmptyRoute,
    });
    // Proves the controller resolves the seller from req.authUser (not from a
    // query param or header the caller controls) and forwards no date when
    // none was requested, leaving the default to the service.
    expect(getDailyRouteMock).toHaveBeenCalledWith(
      expect.anything(),
      SELLER_ID,
      undefined
    );
  });

  it('devuelve 200 con routes y stops vacios cuando el vendedor no tiene ruta ese dia', async () => {
    asSeller();
    getDailyRouteMock.mockResolvedValue(emptyRoute);

    const res = await request(app)
      .get('/api/v1/me/route?date=2026-09-20')
      .set('Authorization', 'Bearer token-de-prueba')
      .set('x-api-key', API_KEY);

    // The contract forbids a 404 here: "no tengo ruta hoy" is a legitimate 200.
    expect(res.status).toBe(200);
    expect(res.body.data.routes).toEqual([]);
    expect(res.body.data.stops).toEqual([]);
    // Proves the validated `date` query param actually reaches the service.
    expect(getDailyRouteMock).toHaveBeenCalledWith(
      expect.anything(),
      SELLER_ID,
      '2026-09-20'
    );
  });

  it('responde 403 para un Administrador y nunca llama al service', async () => {
    verifyAccessTokenMock.mockResolvedValue({ sub: AUTH_ID });
    findUserByAuthUserIdMock.mockResolvedValue(adminRecord);
    getDailyRouteMock.mockResolvedValue(nonEmptyRoute);

    const res = await request(app)
      .get('/api/v1/me/route')
      .set('Authorization', 'Bearer token-de-prueba')
      .set('x-api-key', API_KEY);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    // This is the first ROLES.SELLER-gated route in the repo: confirming the
    // service was never reached is what proves the guard blocked the request
    // instead of the controller happening to reject the Admin on its own.
    expect(getDailyRouteMock).not.toHaveBeenCalled();
  });

  it('responde 401 sin token y nunca llama al service', async () => {
    const res = await request(app)
      .get('/api/v1/me/route')
      .set('x-api-key', API_KEY);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(getDailyRouteMock).not.toHaveBeenCalled();
  });

  it('responde 400 cuando date no viene en formato YYYY-MM-DD', async () => {
    asSeller();

    const res = await request(app)
      .get('/api/v1/me/route?date=19-09-2026')
      .set('Authorization', 'Bearer token-de-prueba')
      .set('x-api-key', API_KEY);

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'date' })])
    );
    expect(getDailyRouteMock).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/v1/me/route/stops/:id/location', () => {
  const STOP_ID = '69b10917-fcbb-4450-b909-73963b7534d8';
  const body = { latitude: 13.7012, longitude: -89.2412, accuracy_meters: 9 };

  it('fija la ubicación del cliente de la parada para el vendedor autenticado', async () => {
    asSeller();
    const data = {
      customer_id: 'd4444444-4444-4444-4444-444444444444',
      location: { lat: 13.7012, lng: -89.2412 },
    };
    setStopCustomerLocationMock.mockResolvedValue(data);

    const res = await request(app)
      .patch(`/api/v1/me/route/stops/${STOP_ID}/location`)
      .set('Authorization', 'Bearer token-de-prueba')
      .set('x-api-key', API_KEY)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: 'Ubicación del cliente establecida correctamente',
      data,
    });
    // The seller comes from the token, never from the request.
    expect(setStopCustomerLocationMock).toHaveBeenCalledWith(
      expect.anything(),
      SELLER_ID,
      STOP_ID,
      body
    );
  });

  it('propaga el 409 del service cuando el cliente ya tenía ubicación', async () => {
    asSeller();
    setStopCustomerLocationMock.mockRejectedValue(
      CustomError.conflict('This customer already has a location')
    );

    const res = await request(app)
      .patch(`/api/v1/me/route/stops/${STOP_ID}/location`)
      .set('Authorization', 'Bearer token-de-prueba')
      .set('x-api-key', API_KEY)
      .send(body);

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it('responde 400 sin accuracy_meters y nunca llama al service', async () => {
    asSeller();

    const res = await request(app)
      .patch(`/api/v1/me/route/stops/${STOP_ID}/location`)
      .set('Authorization', 'Bearer token-de-prueba')
      .set('x-api-key', API_KEY)
      .send({ latitude: 13.7, longitude: -89.2 });

    expect(res.status).toBe(400);
    expect(setStopCustomerLocationMock).not.toHaveBeenCalled();
  });

  it('responde 400 cuando el id de la parada no es un uuid', async () => {
    asSeller();

    const res = await request(app)
      .patch('/api/v1/me/route/stops/no-es-uuid/location')
      .set('Authorization', 'Bearer token-de-prueba')
      .set('x-api-key', API_KEY)
      .send(body);

    expect(res.status).toBe(400);
    expect(setStopCustomerLocationMock).not.toHaveBeenCalled();
  });

  it('responde 403 para un Administrador y nunca llama al service', async () => {
    verifyAccessTokenMock.mockResolvedValue({ sub: AUTH_ID });
    findUserByAuthUserIdMock.mockResolvedValue(adminRecord);

    const res = await request(app)
      .patch(`/api/v1/me/route/stops/${STOP_ID}/location`)
      .set('Authorization', 'Bearer token-de-prueba')
      .set('x-api-key', API_KEY)
      .send(body);

    // Admins set pins through PATCH /customers/:id/location, which can also
    // move an existing one; this route is the seller's narrower door.
    expect(res.status).toBe(403);
    expect(setStopCustomerLocationMock).not.toHaveBeenCalled();
  });
});
