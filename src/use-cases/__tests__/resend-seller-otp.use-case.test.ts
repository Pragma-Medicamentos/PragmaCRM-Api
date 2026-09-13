import { resendSellerOtp } from '../resend-seller-otp.use-case';
import { getSellerById, SellerRecord } from '../../services/seller.service';
import { sendLoginOtp } from '../../services/supabaseAdmin.service';
import { Client } from '../../lib/prisma';

jest.mock('../../services/seller.service');
jest.mock('../../services/supabaseAdmin.service');

const getSellerByIdMock = getSellerById as jest.Mock;
const sendLoginOtpMock = sendLoginOtp as jest.Mock;

const AUTH_ID = '66666666-6666-6666-6666-666666666666';
const SELLER_ID = '77777777-7777-7777-7777-777777777777';

const seller: SellerRecord = {
  id: SELLER_ID,
  name: 'Vendedor Nuevo',
  email: 'nuevo@pragma.test',
  active: true,
  auth_user_id: AUTH_ID,
  created_at: new Date(),
  updated_at: new Date(),
};

const client = {} as Client;

describe('resendSellerOtp', () => {
  beforeEach(() => {
    getSellerByIdMock.mockResolvedValue(seller);
    sendLoginOtpMock.mockResolvedValue(undefined);
  });

  it('reenvia el OTP al correo del vendedor', async () => {
    const result = await resendSellerOtp(client, SELLER_ID);

    expect(result).toEqual(seller);
    expect(sendLoginOtpMock).toHaveBeenCalledWith(seller.email);
  });

  it('rechaza si el vendedor esta deshabilitado', async () => {
    getSellerByIdMock.mockResolvedValue({ ...seller, active: false });

    await expect(resendSellerOtp(client, SELLER_ID)).rejects.toMatchObject({
      statusCode: 409,
    });

    expect(sendLoginOtpMock).not.toHaveBeenCalled();
  });

  it('rechaza si no hay auth_user_id vinculado', async () => {
    getSellerByIdMock.mockResolvedValue({ ...seller, auth_user_id: null });

    await expect(resendSellerOtp(client, SELLER_ID)).rejects.toMatchObject({
      statusCode: 409,
    });

    expect(sendLoginOtpMock).not.toHaveBeenCalled();
  });
});
