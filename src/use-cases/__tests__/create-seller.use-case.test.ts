import { createSeller } from '../create-seller.use-case';
import { createSellerProfile, SellerRecord } from '../../services/seller.service';
import {
  createSellerAuthUser,
  deleteAuthUser,
  sendLoginOtp,
} from '../../services/supabaseAdmin.service';
import { logger } from '../../lib/adapters/logger';
import { Client } from '../../lib/prisma';

jest.mock('../../services/seller.service');
jest.mock('../../services/supabaseAdmin.service');

const createSellerProfileMock = createSellerProfile as jest.Mock;
const createSellerAuthUserMock = createSellerAuthUser as jest.Mock;
const sendLoginOtpMock = sendLoginOtp as jest.Mock;
const deleteAuthUserMock = deleteAuthUser as jest.Mock;

const AUTH_ID = '66666666-6666-6666-6666-666666666666';

const seller: SellerRecord = {
  id: '77777777-7777-7777-7777-777777777777',
  name: 'Vendedor Nuevo',
  email: 'nuevo@pragma.test',
  active: true,
  auth_user_id: AUTH_ID,
  created_at: new Date(),
  updated_at: new Date(),
};

const client = {} as Client;
const input = { name: seller.name, email: seller.email as string };

describe('createSeller', () => {
  it('crea la identidad primero, el perfil y envia el OTP de onboarding', async () => {
    createSellerAuthUserMock.mockResolvedValue({ authUserId: AUTH_ID });
    createSellerProfileMock.mockResolvedValue(seller);
    sendLoginOtpMock.mockResolvedValue(undefined);

    const result = await createSeller(client, input);

    expect(result).toEqual({ seller });
    expect(createSellerAuthUserMock).toHaveBeenCalledWith(input.email);
    expect(createSellerProfileMock).toHaveBeenCalledWith(client, input, AUTH_ID);
    expect(sendLoginOtpMock).toHaveBeenCalledWith(input.email);
    expect(deleteAuthUserMock).not.toHaveBeenCalled();
  });

  it('borra la identidad si falla el perfil, y propaga el error original', async () => {
    createSellerAuthUserMock.mockResolvedValue({ authUserId: AUTH_ID });
    const failure = new Error('correo duplicado');
    createSellerProfileMock.mockRejectedValue(failure);
    deleteAuthUserMock.mockResolvedValue(undefined);

    await expect(createSeller(client, input)).rejects.toThrow(failure);

    expect(deleteAuthUserMock).toHaveBeenCalledWith(AUTH_ID);
    expect(sendLoginOtpMock).not.toHaveBeenCalled();
  });

  it('no revierte el alta si el OTP falla despues de crear el perfil', async () => {
    createSellerAuthUserMock.mockResolvedValue({ authUserId: AUTH_ID });
    createSellerProfileMock.mockResolvedValue(seller);
    sendLoginOtpMock.mockRejectedValue(new Error('SMTP caido'));
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);

    await expect(createSeller(client, input)).resolves.toEqual({ seller });

    expect(errorSpy).toHaveBeenCalled();
    expect(deleteAuthUserMock).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('no toca la base si no se pudo crear la identidad', async () => {
    createSellerAuthUserMock.mockRejectedValue(new Error('email_exists'));

    await expect(createSeller(client, input)).rejects.toThrow('email_exists');

    expect(createSellerProfileMock).not.toHaveBeenCalled();
    expect(deleteAuthUserMock).not.toHaveBeenCalled();
  });
});
