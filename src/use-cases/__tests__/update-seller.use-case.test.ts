import { updateSellerEverywhere } from '../update-seller.use-case';
import { setSellerStatusEverywhere } from '../set-seller-status.use-case';
import { getSellerById, SellerRecord, updateSeller } from '../../services/seller.service';
import { sendLoginOtp, updateAuthUserEmail } from '../../services/supabaseAdmin.service';
import { logger } from '../../lib/adapters/logger';
import { Client } from '../../lib/prisma';

jest.mock('../../services/seller.service');
jest.mock('../../services/supabaseAdmin.service');
jest.mock('../set-seller-status.use-case');

const getSellerByIdMock = getSellerById as jest.Mock;
const updateSellerMock = updateSeller as jest.Mock;
const updateAuthUserEmailMock = updateAuthUserEmail as jest.Mock;
const sendLoginOtpMock = sendLoginOtp as jest.Mock;
const setSellerStatusEverywhereMock = setSellerStatusEverywhere as jest.Mock;

const AUTH_ID = '66666666-6666-6666-6666-666666666666';
const SELLER_ID = '77777777-7777-7777-7777-777777777777';
const EMAIL = 'importado@pragma.test';

// Shape the ERP import leaves behind: no email, disabled, auth account linked.
const imported: SellerRecord = {
  id: SELLER_ID,
  name: 'Vendedor Importado',
  email: null,
  erp_user_id: 42,
  active: false,
  auth_user_id: AUTH_ID,
  created_at: new Date(),
  updated_at: new Date(),
};

const withEmail: SellerRecord = { ...imported, email: EMAIL };
const enabled: SellerRecord = { ...withEmail, active: true };

const appUserUpdateMock = jest.fn();
const client = { app_user: { update: appUserUpdateMock } } as unknown as Client;

describe('updateSellerEverywhere', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    updateAuthUserEmailMock.mockResolvedValue(undefined);
    sendLoginOtpMock.mockResolvedValue(undefined);
    setSellerStatusEverywhereMock.mockResolvedValue(enabled);
  });

  describe('primer correo de un vendedor importado del JSON', () => {
    beforeEach(() => {
      getSellerByIdMock.mockResolvedValue(imported);
      updateSellerMock.mockResolvedValue(withEmail);
    });

    it('sincroniza Auth, habilita al vendedor y envia el correo de acceso', async () => {
      const result = await updateSellerEverywhere(client, SELLER_ID, { email: EMAIL });

      expect(result).toEqual({ seller: enabled, accessEmail: 'sent' });
      expect(updateAuthUserEmailMock).toHaveBeenCalledWith(AUTH_ID, EMAIL);
      expect(setSellerStatusEverywhereMock).toHaveBeenCalledWith(client, SELLER_ID, true);
      expect(sendLoginOtpMock).toHaveBeenCalledWith(EMAIL);
    });

    it('envia el codigo despues de habilitar, para que no llegue a una cuenta baneada', async () => {
      await updateSellerEverywhere(client, SELLER_ID, { email: EMAIL });

      expect(setSellerStatusEverywhereMock.mock.invocationCallOrder[0]).toBeLessThan(
        sendLoginOtpMock.mock.invocationCallOrder[0]
      );
    });

    it('conserva el correo y reporta failed si el envio falla', async () => {
      sendLoginOtpMock.mockRejectedValue(new Error('SMTP caido'));
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);

      const result = await updateSellerEverywhere(client, SELLER_ID, { email: EMAIL });

      expect(result).toEqual({ seller: enabled, accessEmail: 'failed' });
      expect(appUserUpdateMock).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('reporta failed sin habilitar si no hay cuenta de acceso vinculada', async () => {
      getSellerByIdMock.mockResolvedValue({ ...imported, auth_user_id: null });
      updateSellerMock.mockResolvedValue({ ...withEmail, auth_user_id: null });
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);

      const result = await updateSellerEverywhere(client, SELLER_ID, { email: EMAIL });

      expect(result.accessEmail).toBe('failed');
      expect(setSellerStatusEverywhereMock).not.toHaveBeenCalled();
      expect(sendLoginOtpMock).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('revierte el correo y no envia nada si Auth rechaza el correo', async () => {
      const conflict = new Error('email_exists');
      updateAuthUserEmailMock.mockRejectedValue(conflict);

      await expect(
        updateSellerEverywhere(client, SELLER_ID, { email: EMAIL })
      ).rejects.toThrow(conflict);

      expect(appUserUpdateMock).toHaveBeenCalledWith({
        where: { id: SELLER_ID },
        data: { email: null },
      });
      expect(setSellerStatusEverywhereMock).not.toHaveBeenCalled();
      expect(sendLoginOtpMock).not.toHaveBeenCalled();
    });
  });

  describe('vendedor que ya tenia correo', () => {
    const existing: SellerRecord = { ...enabled, email: 'anterior@pragma.test' };

    beforeEach(() => {
      getSellerByIdMock.mockResolvedValue(existing);
    });

    it('cambiar el correo no habilita ni envia el correo de acceso', async () => {
      updateSellerMock.mockResolvedValue({ ...existing, email: EMAIL });

      const result = await updateSellerEverywhere(client, SELLER_ID, { email: EMAIL });

      expect(result.accessEmail).toBeNull();
      expect(updateAuthUserEmailMock).toHaveBeenCalledWith(AUTH_ID, EMAIL);
      expect(setSellerStatusEverywhereMock).not.toHaveBeenCalled();
      expect(sendLoginOtpMock).not.toHaveBeenCalled();
    });

    it('editar solo el nombre no toca Auth', async () => {
      updateSellerMock.mockResolvedValue({ ...existing, name: 'Nuevo nombre' });

      const result = await updateSellerEverywhere(client, SELLER_ID, { name: 'Nuevo nombre' });

      expect(result.accessEmail).toBeNull();
      expect(updateAuthUserEmailMock).not.toHaveBeenCalled();
      expect(sendLoginOtpMock).not.toHaveBeenCalled();
    });
  });

  it('editar el nombre de un importado sin correo no envia nada', async () => {
    getSellerByIdMock.mockResolvedValue(imported);
    updateSellerMock.mockResolvedValue({ ...imported, name: 'Nuevo nombre' });

    const result = await updateSellerEverywhere(client, SELLER_ID, { name: 'Nuevo nombre' });

    expect(result).toEqual({
      seller: { ...imported, name: 'Nuevo nombre' },
      accessEmail: null,
    });
    expect(setSellerStatusEverywhereMock).not.toHaveBeenCalled();
    expect(sendLoginOtpMock).not.toHaveBeenCalled();
  });
});
