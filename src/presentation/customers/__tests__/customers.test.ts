import request from 'supertest';
import { AppRoutes } from '../../routes';
import { Server } from '../../server';
import {
  getCreditStatus,
  getCustomerProfile,
  listCustomerSales,
  listCustomers,
} from '../../../services/customer.service';

// No auth middleware is mounted on /api/v1/customers yet: the requireAuth /
// requireRole wiring is pending changes landing from another branch (see
// TODO in presentation/routes.ts). No @clerk/express mock is needed here.
jest.mock('../../../services/customer.service', () => ({
  listCustomers: jest.fn(),
  getCustomerProfile: jest.fn(),
  listCustomerSales: jest.fn(),
  getCreditStatus: jest.fn(),
  assertCustomerExists: jest.fn(),
}));

const listCustomersMock = listCustomers as jest.Mock;
const getCustomerProfileMock = getCustomerProfile as jest.Mock;
const listCustomerSalesMock = listCustomerSales as jest.Mock;
const getCreditStatusMock = getCreditStatus as jest.Mock;

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

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
    await request(app).get('/api/v1/customers');

    expect(listCustomersMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ page: 1, limit: 20 })
    );
  });

  it('convierte los filtros de query a sus tipos', async () => {
    await request(app).get(
      '/api/v1/customers?page=3&limit=50&without_gps=true&active=false&zone=Escal%C3%B3n'
    );

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
    const res = await request(app).get('/api/v1/customers?category=Z');

    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe('category');
  });

  it('rechaza un limit por encima del tope', async () => {
    const res = await request(app).get('/api/v1/customers?limit=500');

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

    const res = await request(app).get('/api/v1/customers');

    expect(res.body.data).toMatchObject({ total: 352, total_pages: 18 });
    expect(res.body.data.items).toHaveLength(1);
  });
});

describe('GET /api/v1/customers/:id', () => {
  it('rechaza un id que no es uuid', async () => {
    const res = await request(app).get('/api/v1/customers/no-es-uuid');

    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe('id');
  });

  it('propaga el 404 del service', async () => {
    const { CustomError } = jest.requireActual('../../../domain/errors/CustomError');
    getCustomerProfileMock.mockRejectedValue(CustomError.notFound('Customer not found'));

    const res = await request(app).get(`/api/v1/customers/${CUSTOMER_ID}`);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Customer not found');
  });
});

describe('GET /api/v1/customers/:id/sales', () => {
  it('no acepta un filtro de cotizaciones: el parámetro ya no existe', async () => {
    await request(app).get(`/api/v1/customers/${CUSTOMER_ID}/sales?type=quotes`);

    const query = listCustomerSalesMock.mock.calls[0][2];
    expect(query).not.toHaveProperty('type');
  });

  it('rechaza un rango de fechas invertido', async () => {
    const res = await request(app).get(
      `/api/v1/customers/${CUSTOMER_ID}/sales?from=2026-06-01&to=2026-01-01`
    );

    expect(res.status).toBe(400);
  });

  it('pasa el rango de fechas ya convertido a Date', async () => {
    await request(app).get(
      `/api/v1/customers/${CUSTOMER_ID}/sales?from=2026-01-01&to=2026-06-30`
    );

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

    const res = await request(app).get(`/api/v1/customers/${CUSTOMER_ID}/credits`);

    expect(res.status).toBe(200);
    expect(res.body.data.totals.credit_available).toBe('4855.00');
  });
});
