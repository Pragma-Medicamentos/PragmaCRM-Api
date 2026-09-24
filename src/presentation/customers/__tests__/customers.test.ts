import request from 'supertest';
import { AppRoutes } from '../../routes';
import { Server } from '../../server';
import { envs } from '../../../config/envs';
import {
  getCreditStatus,
  getCustomerProfile,
  listCustomerSales,
  listCustomers,
  updateCustomerContact,
  updateCustomerLocation,
} from '../../../services/customer.service';

// The customers module is admin-only now (RF-02). The auth chain is stubbed
// so these tests keep exercising the HTTP layer, not token verification.
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

jest.mock('../../../services/customer.service', () => ({
  listCustomers: jest.fn(),
  getCustomerProfile: jest.fn(),
  listCustomerSales: jest.fn(),
  getCreditStatus: jest.fn(),
  assertCustomerExists: jest.fn(),
  updateCustomerLocation: jest.fn(),
  updateCustomerContact: jest.fn(),
}));

const listCustomersMock = listCustomers as jest.Mock;
const getCustomerProfileMock = getCustomerProfile as jest.Mock;
const listCustomerSalesMock = listCustomerSales as jest.Mock;
const getCreditStatusMock = getCreditStatus as jest.Mock;
const updateCustomerLocationMock = updateCustomerLocation as jest.Mock;
const updateCustomerContactMock = updateCustomerContact as jest.Mock;

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

// Every request needs both layers: the transport x-api-key gate and an admin
// session whose JWT is stubbed above.
const AUTH = {
  'x-api-key': envs.API_KEY,
  Authorization: 'Bearer token-de-prueba',
};

const CUSTOMER_ID = '9f1c2e4a-7b3d-4e21-9c88-0a5d6f2b1e10';

const emptyPage = { items: [], page: 1, page_size: 20, total: 0, total_pages: 0 };

beforeEach(() => {
  jest.clearAllMocks();
  listCustomersMock.mockResolvedValue(emptyPage);
  listCustomerSalesMock.mockResolvedValue(emptyPage);
  getCreditStatusMock.mockResolvedValue({ ...emptyPage, totals: {} });
  getCustomerProfileMock.mockResolvedValue({ id: CUSTOMER_ID, name: 'Farmacia San José' });
});

describe('GET /api/v1/customers', () => {
  it('aplica los valores por defecto de paginación', async () => {
    await request(app).get('/api/v1/customers').set(AUTH);

    expect(listCustomersMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ page: 1, limit: 20 })
    );
  });

  it('convierte los filtros de query a sus tipos', async () => {
    await request(app)
      .get(
        '/api/v1/customers?page=3&limit=50&without_gps=true&active=false&zone=Escal%C3%B3n'
      )
      .set(AUTH);

    expect(listCustomersMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        page: 3,
        limit: 50,
        without_gps: true,
        active: false,
        zone: 'Escalón',
      })
    );
  });

  it('rechaza una categoría fuera del dominio', async () => {
    const res = await request(app).get('/api/v1/customers?category=Z').set(AUTH);

    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe('category');
  });

  it('rechaza un limit por encima del tope', async () => {
    const res = await request(app).get('/api/v1/customers?limit=500').set(AUTH);

    expect(res.status).toBe(400);
  });

  it('devuelve la página dentro de data', async () => {
    listCustomersMock.mockResolvedValue({
      items: [{ id: CUSTOMER_ID, name: 'Farmacia San José' }],
      page: 1,
      page_size: 20,
      total: 352,
      total_pages: 18,
    });

    const res = await request(app).get('/api/v1/customers').set(AUTH);

    expect(res.body.data).toMatchObject({ total: 352, total_pages: 18 });
    expect(res.body.data.items).toHaveLength(1);
  });
});

describe('GET /api/v1/customers/:id', () => {
  it('rechaza un id que no es uuid', async () => {
    const res = await request(app)
      .get('/api/v1/customers/no-es-uuid')
      .set(AUTH);

    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe('id');
  });

  it('propaga el 404 del service', async () => {
    const { CustomError } = jest.requireActual('../../../domain/errors/CustomError');
    getCustomerProfileMock.mockRejectedValue(CustomError.notFound('Customer not found'));

    const res = await request(app)
      .get(`/api/v1/customers/${CUSTOMER_ID}`)
      .set(AUTH);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Customer not found');
  });
});

describe('GET /api/v1/customers/:id/sales', () => {
  it('no acepta un filtro de cotizaciones: el parámetro ya no existe', async () => {
    await request(app)
      .get(`/api/v1/customers/${CUSTOMER_ID}/sales?type=quotes`)
      .set(AUTH);

    const query = listCustomerSalesMock.mock.calls[0][2];
    expect(query).not.toHaveProperty('type');
  });

  it('rechaza un rango de fechas invertido', async () => {
    const res = await request(app)
      .get(
        `/api/v1/customers/${CUSTOMER_ID}/sales?from=2026-06-01&to=2026-01-01`
      )
      .set(AUTH);

    expect(res.status).toBe(400);
  });

  it('pasa el rango de fechas ya convertido a Date', async () => {
    await request(app)
      .get(
        `/api/v1/customers/${CUSTOMER_ID}/sales?from=2026-01-01&to=2026-06-30`
      )
      .set(AUTH);

    const query = listCustomerSalesMock.mock.calls[0][2];
    expect(query.from).toBeInstanceOf(Date);
    expect(query.to).toBeInstanceOf(Date);
  });
});

describe('GET /api/v1/customers/:id/credits', () => {
  it('devuelve los totales junto a la página', async () => {
    getCreditStatusMock.mockResolvedValue({
      ...emptyPage,
      totals: {
        pending_balance: '145.00',
        overdue_amount: '0.00',
        overdue_count: 0,
        credit_limit: '5000.00',
        credit_available: '4855.00',
      },
    });

    const res = await request(app)
      .get(`/api/v1/customers/${CUSTOMER_ID}/credits`)
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data.totals.credit_available).toBe('4855.00');
  });
});

describe('PATCH /api/v1/customers/:id/location', () => {
  const locationBody = { latitude: 13.6929, longitude: -89.2182 };

  it('rechaza un id que no es uuid', async () => {
    const res = await request(app)
      .patch('/api/v1/customers/no-es-uuid/location')
      .set(AUTH)
      .send(locationBody);

    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe('id');
  });

  it('rechaza una latitud fuera de rango', async () => {
    const res = await request(app)
      .patch(`/api/v1/customers/${CUSTOMER_ID}/location`)
      .set(AUTH)
      .send({ latitude: 100, longitude: -89.2182 });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe('latitude');
  });

  it('propaga el 404 del service', async () => {
    const { CustomError } = jest.requireActual('../../../domain/errors/CustomError');
    updateCustomerLocationMock.mockRejectedValue(
      CustomError.notFound('Customer not found')
    );

    const res = await request(app)
      .patch(`/api/v1/customers/${CUSTOMER_ID}/location`)
      .set(AUTH)
      .send(locationBody);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Customer not found');
  });

  it('devuelve la ubicación actualizada', async () => {
    updateCustomerLocationMock.mockResolvedValue({
      id: CUSTOMER_ID,
      name: 'Farmacia San José',
      location: { lat: 13.6929, lng: -89.2182 },
    });

    const res = await request(app)
      .patch(`/api/v1/customers/${CUSTOMER_ID}/location`)
      .set(AUTH)
      .send(locationBody);

    expect(res.status).toBe(200);
    expect(res.body.data.location).toEqual({ lat: 13.6929, lng: -89.2182 });
    expect(updateCustomerLocationMock).toHaveBeenCalledWith(
      expect.anything(),
      CUSTOMER_ID,
      locationBody
    );
  });

  it('acepta address y place_id opcionales de Places', async () => {
    const body = {
      ...locationBody,
      address: 'Av. La Revolución 123, San Salvador',
      place_id: 'ChIJplace123',
    };
    updateCustomerLocationMock.mockResolvedValue({
      id: CUSTOMER_ID,
      name: 'Farmacia San José',
      address: body.address,
      place_id: body.place_id,
      location: { lat: 13.6929, lng: -89.2182 },
    });

    const res = await request(app)
      .patch(`/api/v1/customers/${CUSTOMER_ID}/location`)
      .set(AUTH)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.data.address).toBe(body.address);
    expect(res.body.data.place_id).toBe(body.place_id);
    expect(updateCustomerLocationMock).toHaveBeenCalledWith(
      expect.anything(),
      CUSTOMER_ID,
      body
    );
  });
});

describe('PATCH /api/v1/customers/:id/contact', () => {
  it('rechaza un id que no es uuid', async () => {
    const res = await request(app)
      .patch('/api/v1/customers/no-es-uuid/contact')
      .set(AUTH)
      .send({ phone: '7822-0667' });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe('id');
  });

  it('rechaza un body vacío', async () => {
    const res = await request(app)
      .patch(`/api/v1/customers/${CUSTOMER_ID}/contact`)
      .set(AUTH)
      .send({});

    expect(res.status).toBe(400);
  });

  it('propaga el 404 del service', async () => {
    const { CustomError } = jest.requireActual('../../../domain/errors/CustomError');
    updateCustomerContactMock.mockRejectedValue(
      CustomError.notFound('Customer not found')
    );

    const res = await request(app)
      .patch(`/api/v1/customers/${CUSTOMER_ID}/contact`)
      .set(AUTH)
      .send({ phone: '7822-0667' });

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Customer not found');
  });

  it('actualiza phone y trade_name', async () => {
    const body = { phone: '7822-0667', trade_name: 'Farmacia Central' };
    updateCustomerContactMock.mockResolvedValue({
      id: CUSTOMER_ID,
      name: 'Farmacia San José',
      ...body,
    });

    const res = await request(app)
      .patch(`/api/v1/customers/${CUSTOMER_ID}/contact`)
      .set(AUTH)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.data.phone).toBe(body.phone);
    expect(res.body.data.trade_name).toBe(body.trade_name);
    expect(updateCustomerContactMock).toHaveBeenCalledWith(
      expect.anything(),
      CUSTOMER_ID,
      body
    );
  });
});