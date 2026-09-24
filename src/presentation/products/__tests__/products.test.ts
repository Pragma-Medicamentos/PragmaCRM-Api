import request from 'supertest';
import { AppRoutes } from '../../routes';
import { Server } from '../../server';
import { envs } from '../../../config/envs';
import { getProductById, listProducts } from '../../../services/product.service';

jest.mock('../../../lib/supabaseJwt', () => ({
  verifyAccessToken: jest.fn().mockResolvedValue({ sub: 'auth-admin' }),
  JwksUnavailableError: class extends Error {},
  warmUpJwks: jest.fn(),
}));

jest.mock('../../../services/auth.service', () => ({
  findUserByAuthUserId: jest.fn().mockResolvedValue({
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    auth_user_id: 'auth-admin',
    role: 'Administrador',
    name: 'Admin',
    email: 'admin@pragma.test',
    active: true,
    password_set_at: new Date('2026-09-11T12:00:00.000Z'),
  }),
}));

jest.mock('../../../services/product.service', () => ({
  listProducts: jest.fn(),
  getProductById: jest.fn(),
}));

const listProductsMock = listProducts as jest.Mock;
const getProductByIdMock = getProductById as jest.Mock;

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

const AUTH = {
  'x-api-key': envs.API_KEY,
  Authorization: 'Bearer token-de-prueba',
};

const emptyPage = { items: [], page: 1, page_size: 20, total: 0, total_pages: 0 };

beforeEach(() => {
  jest.clearAllMocks();
  listProductsMock.mockResolvedValue(emptyPage);
});

describe('GET /api/v1/products', () => {
  it('aplica los valores por defecto de paginación', async () => {
    await request(app).get('/api/v1/products').set(AUTH);

    expect(listProductsMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ page: 1, limit: 20 })
    );
  });

  it('pasa el filtro search', async () => {
    await request(app).get('/api/v1/products?search=anti').set(AUTH);

    expect(listProductsMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ search: 'anti' })
    );
  });

  it('rechaza un limit por encima del tope', async () => {
    const res = await request(app).get('/api/v1/products?limit=500').set(AUTH);

    expect(res.status).toBe(400);
  });

  it('devuelve la página dentro de data', async () => {
    listProductsMock.mockResolvedValue({
      items: [{ erp_product_id: 123, name: 'Producto' }],
      page: 1,
      page_size: 20,
      total: 300,
      total_pages: 15,
    });

    const res = await request(app).get('/api/v1/products').set(AUTH);

    expect(res.body.data).toMatchObject({ total: 300, total_pages: 15 });
    expect(res.body.data.items).toHaveLength(1);
  });
});

describe('GET /api/v1/products/:id', () => {
  it('rechaza un id que no es entero', async () => {
    const res = await request(app).get('/api/v1/products/abc').set(AUTH);

    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe('id');
  });

  it('propaga el 404 del service', async () => {
    const { CustomError } = jest.requireActual('../../../domain/errors/CustomError');
    getProductByIdMock.mockRejectedValue(CustomError.notFound('Product not found'));

    const res = await request(app).get('/api/v1/products/999').set(AUTH);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Product not found');
  });

  it('devuelve el producto', async () => {
    getProductByIdMock.mockResolvedValue({
      erp_product_id: 123,
      code: 'ABC',
      name: 'Producto',
      product_group: 'ANALGESICOS',
      last_seen_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });

    const res = await request(app).get('/api/v1/products/123').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data.erp_product_id).toBe(123);
    expect(getProductByIdMock).toHaveBeenCalledWith(expect.anything(), 123);
  });
});
