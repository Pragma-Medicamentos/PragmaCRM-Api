import { createSeller } from '../create-seller.use-case';
import {
  createSellerProfile,
  deleteSellerProfile,
} from '../../services/seller.service';
import { inviteSeller } from '../../services/clerk.service';
import { Client } from '../../lib/prisma';

jest.mock('../../services/seller.service');
jest.mock('../../services/clerk.service');

const createSellerProfileMock = createSellerProfile as jest.Mock;
const deleteSellerProfileMock = deleteSellerProfile as jest.Mock;
const inviteSellerMock = inviteSeller as jest.Mock;

const client = {} as Client;

const seller = {
  id: 'seller-id',
  name: 'Vendedor de prueba',
  email: 'vendedor@pragma.test',
  active: true,
  clerk_user_id: null,
  created_at: new Date(),
  updated_at: new Date(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('createSeller', () => {
  it('crea el perfil y envía la invitación de Clerk al correo del vendedor', async () => {
    createSellerProfileMock.mockResolvedValue(seller);
    inviteSellerMock.mockResolvedValue(undefined);

    const result = await createSeller(client, {
      name: seller.name,
      email: seller.email,
    });

    expect(result).toBe(seller);
    expect(inviteSellerMock).toHaveBeenCalledWith(seller.email);
    expect(deleteSellerProfileMock).not.toHaveBeenCalled();
  });

  it('revierte el perfil creado si la invitación de Clerk falla', async () => {
    createSellerProfileMock.mockResolvedValue(seller);
    const clerkError = new Error('Clerk no disponible');
    inviteSellerMock.mockRejectedValue(clerkError);
    deleteSellerProfileMock.mockResolvedValue(undefined);

    await expect(
      createSeller(client, { name: seller.name, email: seller.email })
    ).rejects.toBe(clerkError);

    expect(deleteSellerProfileMock).toHaveBeenCalledWith(client, seller.id);
  });

  it('no deja sin capturar un fallo en la compensación', async () => {
    createSellerProfileMock.mockResolvedValue(seller);
    inviteSellerMock.mockRejectedValue(new Error('Clerk no disponible'));
    deleteSellerProfileMock.mockRejectedValue(new Error('DB caída'));

    await expect(
      createSeller(client, { name: seller.name, email: seller.email })
    ).rejects.toThrow('Clerk no disponible');
  });
});
