import { Client } from '../../lib/prisma';
import { ROLES } from '../../domain/types/auth.types';
import {
  createSellerProfile,
  getSellerById,
  listSellers,
  setSellerStatus,
  updateSeller,
} from '../seller.service';

const SELLER_ID = '11111111-1111-1111-1111-111111111111';

const seller = (overrides: Record<string, unknown> = {}) => ({
  id: SELLER_ID,
  name: 'Vendedor de prueba',
  email: 'vendedor@pragma.test',
  active: true,
  clerk_user_id: null,
  created_at: new Date(),
  updated_at: new Date(),
  ...overrides,
});

const buildClient = (overrides: Record<string, jest.Mock> = {}) =>
  ({
    app_user: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      ...overrides,
    },
  }) as unknown as Client;

describe('listSellers', () => {
  it('filtra por role Vendedor y deleted_at IS NULL', async () => {
    const findMany = jest.fn().mockResolvedValue([seller()]);
    const client = buildClient({ findMany });

    await listSellers(client, {});

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: ROLES.SELLER, deleted_at: null },
      })
    );
  });

  it('agrega el filtro active cuando viene definido', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const client = buildClient({ findMany });

    await listSellers(client, { active: false });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: ROLES.SELLER, deleted_at: null, active: false },
      })
    );
  });
});

describe('getSellerById', () => {
  it('lanza 404 cuando no existe el vendedor', async () => {
    const client = buildClient({ findFirst: jest.fn().mockResolvedValue(null) });

    await expect(getSellerById(client, SELLER_ID)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('retorna el vendedor cuando existe', async () => {
    const client = buildClient({
      findFirst: jest.fn().mockResolvedValue(seller()),
    });

    await expect(getSellerById(client, SELLER_ID)).resolves.toMatchObject({
      id: SELLER_ID,
    });
  });
});

describe('createSellerProfile', () => {
  it('lanza 409 si ya existe un usuario activo con ese correo', async () => {
    const client = buildClient({
      findFirst: jest.fn().mockResolvedValue(seller()),
      create: jest.fn(),
    });

    await expect(
      createSellerProfile(client, { name: 'Nuevo', email: 'vendedor@pragma.test' })
    ).rejects.toMatchObject({ statusCode: 409 });

    expect((client.app_user.create as jest.Mock)).not.toHaveBeenCalled();
  });

  it('crea el perfil con role Vendedor y active true', async () => {
    const create = jest.fn().mockResolvedValue(seller());
    const client = buildClient({
      findFirst: jest.fn().mockResolvedValue(null),
      create,
    });

    await createSellerProfile(client, { name: 'Nuevo', email: 'nuevo@pragma.test' });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          name: 'Nuevo',
          email: 'nuevo@pragma.test',
          role: ROLES.SELLER,
          active: true,
        },
      })
    );
  });
});

describe('updateSeller', () => {
  it('lanza 404 si el vendedor no existe', async () => {
    const client = buildClient({ findFirst: jest.fn().mockResolvedValue(null) });

    await expect(
      updateSeller(client, SELLER_ID, { name: 'Otro' })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('lanza 409 si el nuevo correo ya está en uso por otro usuario', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(seller())
      .mockResolvedValueOnce(seller({ id: 'otro-id' }));
    const client = buildClient({ findFirst, update: jest.fn() });

    await expect(
      updateSeller(client, SELLER_ID, { email: 'repetido@pragma.test' })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('actualiza solo los campos enviados', async () => {
    const findFirst = jest.fn().mockResolvedValue(seller());
    const update = jest.fn().mockResolvedValue(seller({ name: 'Actualizado' }));
    const client = buildClient({ findFirst, update });

    await updateSeller(client, SELLER_ID, { name: 'Actualizado' });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SELLER_ID },
        data: expect.objectContaining({ name: 'Actualizado' }),
      })
    );
  });
});

describe('setSellerStatus', () => {
  it('lanza 404 si el vendedor no existe', async () => {
    const client = buildClient({ findFirst: jest.fn().mockResolvedValue(null) });

    await expect(setSellerStatus(client, SELLER_ID, false)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('actualiza el campo active', async () => {
    const findFirst = jest.fn().mockResolvedValue(seller());
    const update = jest.fn().mockResolvedValue(seller({ active: false }));
    const client = buildClient({ findFirst, update });

    await setSellerStatus(client, SELLER_ID, false);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SELLER_ID },
        data: expect.objectContaining({ active: false }),
      })
    );
  });
});
