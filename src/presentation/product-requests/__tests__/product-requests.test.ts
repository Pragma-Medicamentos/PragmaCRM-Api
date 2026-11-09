import request from 'supertest';
import { AppRoutes } from '../../routes';
import { Server } from '../../server';
import { envs } from '../../../config/envs';
import { CustomError } from '../../../domain/errors/CustomError';
import {
  createProductRequest,
  getOffCatalogDemand,
  getOffCatalogProductDemand,
  listDemandedProducts,
} from '../../../services/product-request.service';
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
  getOffCatalogDemand: jest.fn(),
  getOffCatalogProductDemand: jest.fn(),
  listDemandedProducts: jest.fn(),
}));

const createMock = createProductRequest as jest.Mock;
const demandMock = getOffCatalogDemand as jest.Mock;
const demandDetailMock = getOffCatalogProductDemand as jest.Mock;
const demandedProductsMock = listDemandedProducts as jest.Mock;
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
  demandMock.mockResolvedValue({ period: {}, totals: {}, products: [] });
  demandDetailMock.mockResolvedValue({ period: {}, product: {}, requests: [] });
  demandedProductsMock.mockResolvedValue([]);
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

describe('GET /api/v1/product-requests/demand', () => {
  const DEMAND = `${PATH}/demand`;
  const PRODUCT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

  beforeEach(() => findUserMock.mockResolvedValue(user('Administrador')));

  it('answers the report to the Administrador with the range from the query', async () => {
    const res = await request(app)
      .get(DEMAND)
      .query({ from: '2026-09-01', to: '2026-09-30' })
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data.products).toEqual([]);
    expect(demandMock).toHaveBeenCalledWith(expect.anything(), {
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });

  it('forbids the Vendedor', async () => {
    findUserMock.mockResolvedValue(user('Vendedor'));

    const res = await request(app).get(DEMAND).set(AUTH);

    expect(res.status).toBe(403);
    expect(demandMock).not.toHaveBeenCalled();
  });

  it.each([
    ['a malformed date', { from: '01/09/2026' }, 'from'],
    ['from after to', { from: '2026-10-01', to: '2026-09-01' }, 'from'],
  ])('rejects %s', async (_label, query, field) => {
    const res = await request(app).get(DEMAND).query(query).set(AUTH);

    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe(field);
    expect(demandMock).not.toHaveBeenCalled();
  });

  it('answers the detail of one product', async () => {
    const res = await request(app).get(`${DEMAND}/${PRODUCT_ID}`).set(AUTH);

    expect(res.status).toBe(200);
    expect(demandDetailMock).toHaveBeenCalledWith(expect.anything(), PRODUCT_ID, {});
  });

  it('rejects a product id that is not a uuid', async () => {
    const res = await request(app).get(`${DEMAND}/42`).set(AUTH);

    expect(res.status).toBe(400);
    expect(demandDetailMock).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown product', async () => {
    demandDetailMock.mockRejectedValue(CustomError.notFound('Off-catalog product not found'));

    const res = await request(app).get(`${DEMAND}/${PRODUCT_ID}`).set(AUTH);

    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/product-requests/products', () => {
  const PRODUCTS = `${PATH}/products`;

  it.each(['Vendedor', 'Administrador'])('answers the %s', async (role) => {
    findUserMock.mockResolvedValue(user(role));

    const res = await request(app).get(PRODUCTS).query({ search: '  ibu ' }).set(AUTH);

    expect(res.status).toBe(200);
    expect(demandedProductsMock).toHaveBeenCalledWith(expect.anything(), { search: 'ibu', limit: 8 });
  });

  it('accepts no search and a custom limit', async () => {
    const res = await request(app).get(PRODUCTS).query({ limit: '20' }).set(AUTH);

    expect(res.status).toBe(200);
    expect(demandedProductsMock).toHaveBeenCalledWith(expect.anything(), { limit: 20 });
  });

  it.each([
    ['a limit over the cap', { limit: '21' }, 'limit'],
    ['a zero limit', { limit: '0' }, 'limit'],
    ['a search too long', { search: 'x'.repeat(121) }, 'search'],
  ])('rejects %s', async (_label, query, field) => {
    const res = await request(app).get(PRODUCTS).query(query).set(AUTH);

    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe(field);
    expect(demandedProductsMock).not.toHaveBeenCalled();
  });
});
