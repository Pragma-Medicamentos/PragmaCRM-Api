import { Client } from '../../lib/prisma';
import { getCustomerById, updateCustomerLocation } from '../customer.service';

const CUSTOMER_ID = '22222222-2222-2222-2222-222222222222';

const customerRow = (overrides: Record<string, unknown> = {}) => ({
  id: CUSTOMER_ID,
  name: 'Farmacia de prueba',
  active: true,
  longitude: -89.2182,
  latitude: 13.6929,
  updated_at: new Date(),
  ...overrides,
});

const buildClient = (overrides: Record<string, jest.Mock> = {}) =>
  ({
    $queryRaw: jest.fn().mockResolvedValue([customerRow()]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    ...overrides,
  }) as unknown as Client;

describe('getCustomerById', () => {
  it('lanza 404 si el cliente no existe o está eliminado', async () => {
    const client = buildClient({ $queryRaw: jest.fn().mockResolvedValue([]) });

    await expect(getCustomerById(client, CUSTOMER_ID)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('devuelve la ubicación en lat/lng cuando el cliente ya la tiene', async () => {
    const client = buildClient();

    const customer = await getCustomerById(client, CUSTOMER_ID);

    expect(customer.location).toEqual({ latitude: 13.6929, longitude: -89.2182 });
  });

  it('devuelve location null cuando el cliente aún no tiene GPS asignado', async () => {
    const client = buildClient({
      $queryRaw: jest
        .fn()
        .mockResolvedValue([customerRow({ latitude: null, longitude: null })]),
    });

    const customer = await getCustomerById(client, CUSTOMER_ID);

    expect(customer.location).toBeNull();
  });
});

describe('updateCustomerLocation', () => {
  it('lanza 404 si el cliente no existe antes de actualizar', async () => {
    const client = buildClient({ $queryRaw: jest.fn().mockResolvedValue([]) });

    await expect(
      updateCustomerLocation(client, CUSTOMER_ID, {
        latitude: 13.6929,
        longitude: -89.2182,
      })
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(client.$executeRaw).not.toHaveBeenCalled();
  });

  it('ejecuta el UPDATE y devuelve el cliente con la ubicación nueva', async () => {
    const client = buildClient();

    const customer = await updateCustomerLocation(client, CUSTOMER_ID, {
      latitude: 13.6929,
      longitude: -89.2182,
    });

    expect(client.$executeRaw).toHaveBeenCalledTimes(1);
    expect(customer.location).toEqual({ latitude: 13.6929, longitude: -89.2182 });
  });
});
