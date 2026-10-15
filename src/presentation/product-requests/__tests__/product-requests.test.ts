import request from 'supertest';
import { AppRoutes } from '../../routes';
import { Server } from '../../server';
import { envs } from '../../../config/envs';
import { CustomError } from '../../../domain/errors/CustomError';
import { createProductRequest } from '../../../services/product-request.service';
import { findUserByAuthUserId } from '../../../services/auth.service';

jest.mock('../../../lib/supabaseJwt', () => ({
  verifyAccessToken: jest.fn().mockResolvedValue({ sub: 'auth-seller' }),
  JwksUnavailableError: class extends Error {},
  warmUpJwks: jest.fn(),
}));

jest.mock('../../../services/auth.service', () => ({
  findUserByAuthUserId: jest.fn(),
}));

// The controller opens the transaction itself; hand the callback a stub client.
jest.mock('../../../lib/prisma', () => ({
  prisma: { $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb({})) },
}));

jest.mock('../../../services/product-request.service', () => ({
  createProductRequest: jest.fn(),
}));

const createMock = createProductRequest as jest.Mock;
const findUserMock = findUserByAuthUserId as jest.Mock;

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

const AUTH = {
  'x-api-key': envs.API_KEY,
  Authorization: 'Bearer token-de-prueba',
};

const SELLER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STOP_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PATH = '/api/v1/product-requests';

const user = (role: string) => ({
  id: SELLER_ID,
  auth_user_id: 'auth-seller',
  role,
  name: 'Seller',
  email: 'seller@pragma.test',
  active: true,
  password_set_at: new Date('2026-09-11T12:00:00.000Z'),
});

const body = (overrides: Record<string, unknown> = {}) => ({
  scheduled_visit_id: STOP_ID,
  product_name: 'Ibuprofeno 400 mg',
  requested_quantity: 12,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  findUserMock.mockResolvedValue(user('Vendedor'));
  createMock.mockResolvedValue({ id: 'request-1' });
});

describe('POST /api/v1/product-requests', () => {
  it('registers the request and answers 201', async () => {
    const res = await request(app).post(PATH).set(AUTH).send(body());

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe('request-1');
  });

  it('passes the authenticated seller, not an id from the body', async () => {
    await request(app)
      .post(PATH)
      .set(AUTH)
      .send(body({ user_id: 'someone-else', customer_id: 'someone-else' }));

    expect(createMock).toHaveBeenCalledWith(
      expect.anything(),
      SELLER_ID,
      expect.not.objectContaining({
        user_id: expect.anything(),
        customer_id: expect.anything(),
      })
    );
  });

  it('collapses whitespace in the product name', async () => {
    await request(app)
      .post(PATH)
      .set(AUTH)
      .send(body({ product_name: '  Ibuprofeno   400 mg ' }));

    expect(createMock.mock.calls[0][2].product_name).toBe('Ibuprofeno 400 mg');
  });

  it('accepts a request without quantity', async () => {
    const res = await request(app)
      .post(PATH)
      .set(AUTH)
      .send(body({ requested_quantity: undefined }));

    expect(res.status).toBe(201);
    expect(createMock.mock.calls[0][2].requested_quantity).toBeUndefined();
  });

  it('forbids the Administrador', async () => {
    findUserMock.mockResolvedValue(user('Administrador'));

    const res = await request(app).post(PATH).set(AUTH).send(body());

    expect(res.status).toBe(403);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('answers 401 without a session', async () => {
    const res = await request(app)
      .post(PATH)
      .set({ 'x-api-key': envs.API_KEY })
      .send(body());

    expect(res.status).toBe(401);
  });

  it.each([
    ['bad stop id', { scheduled_visit_id: 'nope' }, 'scheduled_visit_id'],
    ['missing product name', { product_name: undefined }, 'product_name'],
    ['blank product name', { product_name: '   ' }, 'product_name'],
    ['zero quantity', { requested_quantity: 0 }, 'requested_quantity'],
    ['negative quantity', { requested_quantity: -3 }, 'requested_quantity'],
    ['quantity as text', { requested_quantity: '12' }, 'requested_quantity'],
  ])('rejects %s', async (_label, override, field) => {
    const res = await request(app).post(PATH).set(AUTH).send(body(override));

    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe(field);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('maps service errors to their status', async () => {
    createMock.mockRejectedValue(
      CustomError.unprocessable('Confirm the stop before registering an off-catalog product')
    );

    const res = await request(app).post(PATH).set(AUTH).send(body());

    expect(res.status).toBe(422);
    expect(res.body.message).toBe(
      'Confirm the stop before registering an off-catalog product'
    );
  });
});
