import { Prisma } from '../../generated/prisma/client';
import { Client } from '../../lib/prisma';
import {
  assertCustomerExists,
  getCreditStatus,
  getCustomerRoutes,
  getRecentVisitNotes,
  listCustomerSales,
  updateCustomerLocation,
} from '../customer.service';

const CUSTOMER_ID = '9f1c2e4a-7b3d-4e21-9c88-0a5d6f2b1e10';
const SELLER = { id: 'u1', name: 'Carlos Martínez' };

const money = (value: string) => new Prisma.Decimal(value);

const saleRow = (overrides: Record<string, unknown> = {}) => ({
  erp_sale_id: 2033,
  erp_created_at: new Date('2026-07-18T10:15:00.000Z'),
  document: 'FAC-2033',
  total: money('212.00'),
  payment_id: 6,
  last_payment_at: new Date('2026-09-01T10:15:00.000Z'),
  app_user: SELLER,
  ...overrides,
});

const buildClient = (overrides: Record<string, unknown> = {}) =>
  ({
    sale: { findMany: jest.fn(), count: jest.fn() },
    customer: { findFirst: jest.fn() },
    visit: { findMany: jest.fn() },
    route_customer: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    ...overrides,
  }) as unknown as Client;

const pagination = { page: 1, limit: 20 };

describe('listCustomerSales', () => {
  it('devuelve solo ventas liquidadas: estado 2, saldo 0 y no borradas', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const client = buildClient({ sale: { findMany, count } });

    await listCustomerSales(client, CUSTOMER_ID, pagination);

    const expected = {
      customer_id: CUSTOMER_ID,
      deleted_at: null,
      erp_status: 2,
      pending_balance: 0,
    };
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expected })
    );
    // El total tiene que contarse con el mismo where, o la paginación miente.
    expect(count).toHaveBeenCalledWith({ where: expected });
  });

  it('nunca devuelve cotizaciones', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const client = buildClient({
      sale: { findMany, count: jest.fn().mockResolvedValue(0) },
    });

    await listCustomerSales(client, CUSTOMER_ID, pagination);

    const { where } = findMany.mock.calls[0][0];
    expect(where.erp_status).toBe(2);
  });

  it('marca el contado sin días de pago', async () => {
    const created = new Date('2026-08-14T16:20:00.000Z');
    const findMany = jest
      .fn()
      .mockResolvedValue([
        saleRow({ payment_id: 1, erp_created_at: created, last_payment_at: created }),
      ]);
    const client = buildClient({
      sale: { findMany, count: jest.fn().mockResolvedValue(1) },
    });

    const page = await listCustomerSales(client, CUSTOMER_ID, pagination);

    expect(page.items[0].payment_type).toBe('cash');
    // Cero días diría "paga al instante"; la respuesta correcta es "no aplica".
    expect(page.items[0].payment_days).toBeNull();
  });

  it('calcula los días que tardó un crédito ya cobrado', async () => {
    const findMany = jest.fn().mockResolvedValue([saleRow()]);
    const client = buildClient({
      sale: { findMany, count: jest.fn().mockResolvedValue(1) },
    });

    const page = await listCustomerSales(client, CUSTOMER_ID, pagination);

    expect(page.items[0].payment_type).toBe('credit_settled');
    expect(page.items[0].payment_days).toBe(45);
    expect(page.items[0].total).toBe('212.00');
  });

  it('aplica el rango de fechas sobre la columna cruda', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const client = buildClient({
      sale: { findMany, count: jest.fn().mockResolvedValue(0) },
    });
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-06-30T23:59:59.000Z');

    await listCustomerSales(client, CUSTOMER_ID, { ...pagination, from, to });

    const { where } = findMany.mock.calls[0][0];
    expect(where.erp_created_at).toEqual({ gte: from, lte: to });
  });

  it('arma la paginación con el total real, no con el tamaño de la página', async () => {
    const findMany = jest.fn().mockResolvedValue([saleRow()]);
    const client = buildClient({
      sale: { findMany, count: jest.fn().mockResolvedValue(47) },
    });

    const page = await listCustomerSales(client, CUSTOMER_ID, { page: 2, limit: 20 });

    expect(page).toMatchObject({ page: 2, page_size: 20, total: 47, total_pages: 3 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 20 })
    );
  });
});

describe('getCreditStatus', () => {
  const creditClient = (findMany: jest.Mock, count: jest.Mock) =>
    buildClient({
      sale: { findMany, count },
      customer: {
        findFirst: jest.fn().mockResolvedValue({ credit_limit: money('5000.00') }),
      },
      $queryRaw: jest.fn().mockResolvedValue([
        { pending_balance: '145.00', overdue_amount: '0.00', overdue_count: 0 },
      ]),
    });

  it('devuelve solo facturas con saldo, sin contado ni cotizaciones', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const client = creditClient(findMany, jest.fn().mockResolvedValue(0));

    await getCreditStatus(client, CUSTOMER_ID, pagination);

    const { where } = findMany.mock.calls[0][0];
    expect(where).toMatchObject({
      customer_id: CUSTOMER_ID,
      deleted_at: null,
      erp_status: 2,
      pending_balance: { gt: 0 },
    });
  });

  it('incluye las filas con payment_id nulo, igual que los totales', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const client = creditClient(findMany, jest.fn().mockResolvedValue(0));

    await getCreditStatus(client, CUSTOMER_ID, pagination);

    // `NOT: { payment_id: 1 }` compila a NOT(payment_id = 1), que con NULL da
    // NULL y descarta la fila. Los totales sí la cuentan, así que la tabla no
    // cuadraría con su propio total.
    const { where } = findMany.mock.calls[0][0];
    expect(where.OR).toEqual([
      { payment_id: { not: 1 } },
      { payment_id: null },
    ]);
  });

  it('marca vencida una factura con más de 60 días', async () => {
    const old = new Date(Date.now() - 91 * 86_400_000);
    const findMany = jest.fn().mockResolvedValue([
      {
        erp_sale_id: 2140,
        document: 'FAC-2140',
        erp_created_at: old,
        total: money('145.00'),
        pending_balance: money('145.00'),
      },
    ]);
    const client = creditClient(findMany, jest.fn().mockResolvedValue(1));

    const page = await getCreditStatus(client, CUSTOMER_ID, pagination);

    expect(page.items[0]).toMatchObject({
      days_since_sale: 91,
      overdue: true,
      days_overdue: 31,
    });
  });

  it('no marca vencida una factura dentro del plazo', async () => {
    const recent = new Date(Date.now() - 45 * 86_400_000);
    const findMany = jest.fn().mockResolvedValue([
      {
        erp_sale_id: 2141,
        document: 'FAC-2141',
        erp_created_at: recent,
        total: money('145.00'),
        pending_balance: money('145.00'),
      },
    ]);
    const client = creditClient(findMany, jest.fn().mockResolvedValue(1));

    const page = await getCreditStatus(client, CUSTOMER_ID, pagination);

    expect(page.items[0]).toMatchObject({ overdue: false, days_overdue: 0 });
  });

  it('calcula el crédito disponible contra el límite del cliente', async () => {
    const client = creditClient(
      jest.fn().mockResolvedValue([]),
      jest.fn().mockResolvedValue(0)
    );

    const page = await getCreditStatus(client, CUSTOMER_ID, pagination);

    expect(page.totals).toMatchObject({
      pending_balance: '145.00',
      credit_limit: '5000.00',
      credit_available: '4855.00',
    });
  });

  it('lanza 404 si el cliente no existe', async () => {
    const client = buildClient({
      sale: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      customer: { findFirst: jest.fn().mockResolvedValue(null) },
    });

    await expect(getCreditStatus(client, CUSTOMER_ID, pagination)).rejects.toThrow(
      'Customer not found'
    );
  });
});

describe('assertCustomerExists', () => {
  it('lanza 404 cuando el cliente está borrado o no existe', async () => {
    const client = buildClient({
      customer: { findFirst: jest.fn().mockResolvedValue(null) },
    });

    await expect(assertCustomerExists(client, CUSTOMER_ID)).rejects.toThrow(
      'Customer not found'
    );
  });

  it('filtra por deleted_at IS NULL', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: CUSTOMER_ID });
    const client = buildClient({ customer: { findFirst } });

    await assertCustomerExists(client, CUSTOMER_ID);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: CUSTOMER_ID, deleted_at: null } })
    );
  });
});

describe('getRecentVisitNotes', () => {
  it('pide solo visitas vivas con nota, de la más reciente hacia atrás', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const client = buildClient({ visit: { findMany } });

    await getRecentVisitNotes(client, CUSTOMER_ID);

    // Sin deleted_at: null la consulta no usa visit_customer_started_idx.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          customer_id: CUSTOMER_ID,
          deleted_at: null,
        }),
        orderBy: { started_at: 'desc' },
        take: 5,
      })
    );
  });
});

describe('getCustomerRoutes', () => {
  it('descarta composiciones borradas y rutas borradas', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([{ route: { id: 'r1', name: 'Zona Escalón' } }]);
    const client = buildClient({ route_customer: { findMany } });

    const routes = await getCustomerRoutes(client, CUSTOMER_ID);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          customer_id: CUSTOMER_ID,
          deleted_at: null,
          route: { deleted_at: null },
        },
      })
    );
    expect(routes).toEqual([{ id: 'r1', name: 'Zona Escalón' }]);
  });
});

describe('updateCustomerLocation', () => {
  const locationInput = { latitude: 13.6929, longitude: -89.2182 };

  const coreRow = (overrides: Record<string, unknown> = {}) => ({
    id: CUSTOMER_ID,
    erp_customer_id: 1001,
    name: 'Farmacia San José',
    trade_name: null,
    establishment_type: null,
    address: null,
    municipality: null,
    zone: null,
    phone: null,
    mobile: null,
    attends: null,
    personality: null,
    potential: null,
    credit: false,
    credit_limit: null,
    origin: null,
    active: true,
    lat: 13.6929,
    lng: -89.2182,
    ...overrides,
  });

  it('lanza 404 si el cliente no existe antes de actualizar', async () => {
    const client = buildClient({
      customer: { findFirst: jest.fn().mockResolvedValue(null) },
    });

    await expect(
      updateCustomerLocation(client, CUSTOMER_ID, locationInput)
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(client.$executeRaw).not.toHaveBeenCalled();
  });

  it('ejecuta el UPDATE y devuelve la ubicación como lat/lng', async () => {
    const client = buildClient({
      customer: { findFirst: jest.fn().mockResolvedValue({ id: CUSTOMER_ID }) },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([coreRow()]),
    });

    const core = await updateCustomerLocation(client, CUSTOMER_ID, locationInput);

    expect(client.$executeRaw).toHaveBeenCalledTimes(1);
    expect(core.location).toEqual({ lat: 13.6929, lng: -89.2182 });
  });
});
