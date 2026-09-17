import { requestLoginOtp } from '../request-login-otp.use-case';
import { findActiveUserByEmail } from '../../services/auth.service';
import { sendLoginOtp } from '../../services/supabaseAdmin.service';
import { Client } from '../../lib/prisma';
import { ROLES } from '../../domain/types/auth.types';

jest.mock('../../services/auth.service');
jest.mock('../../services/supabaseAdmin.service');

const findActiveUserByEmailMock = findActiveUserByEmail as jest.Mock;
const sendLoginOtpMock = sendLoginOtp as jest.Mock;

const client = {} as Client;
const email = 'vendedor@pragma.test';

describe('requestLoginOtp', () => {
  it('envia OTP cuando el correo pertenece a un usuario activo', async () => {
    findActiveUserByEmailMock.mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      auth_user_id: '22222222-2222-2222-2222-222222222222',
      role: ROLES.SELLER,
      email,
      active: true,
      password_set_at: null,
    });
    sendLoginOtpMock.mockResolvedValue(undefined);

    await requestLoginOtp(client, email);

    expect(sendLoginOtpMock).toHaveBeenCalledWith(email);
  });

  it('responde 404 si no hay cuenta activa', async () => {
    findActiveUserByEmailMock.mockResolvedValue(null);

    await expect(requestLoginOtp(client, email)).rejects.toMatchObject({
      statusCode: 404,
    });

    expect(sendLoginOtpMock).not.toHaveBeenCalled();
  });

  it('responde 409 si la cuenta no tiene auth_user_id', async () => {
    findActiveUserByEmailMock.mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      auth_user_id: null,
      role: ROLES.SELLER,
      email,
      active: true,
      password_set_at: null,
    });

    await expect(requestLoginOtp(client, email)).rejects.toMatchObject({
      statusCode: 409,
    });

    expect(sendLoginOtpMock).not.toHaveBeenCalled();
  });
});
