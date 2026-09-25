import { CustomError } from '../../domain/errors/CustomError';
import { ROLES } from '../../domain/types/auth.types';
import { findUserByAuthUserId } from '../../services/auth.service';
import {
  revokeSession,
  signInWithPassword,
} from '../../services/supabaseSession.service';
import { establishSession } from '../establish-session.use-case';

jest.mock('../../services/auth.service', () => ({
  findUserByAuthUserId: jest.fn(),
}));

jest.mock('../../services/supabaseSession.service', () => ({
  signInWithPassword: jest.fn(),
  verifyEmailOtp: jest.fn(),
  refreshSession: jest.fn(),
  revokeSession: jest.fn(),
}));

const findUserMock = findUserByAuthUserId as jest.Mock;
const signInMock = signInWithPassword as jest.Mock;
const revokeMock = revokeSession as jest.Mock;

const goTrue = {
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresIn: 3600,
  authUserId: 'auth-id',
};

const record = {
  id: 'crm-id',
  auth_user_id: 'auth-id',
  role: ROLES.ADMIN,
  name: 'Admin',
  email: 'admin@pragma.test',
  active: true,
  password_set_at: null,
};

describe('establishSession', () => {
  const client = {} as never;

  it('returns the CRM user and keeps the tokens for the cookie layer', async () => {
    signInMock.mockResolvedValue(goTrue);
    findUserMock.mockResolvedValue(record);

    const session = await establishSession(client, {
      email: 'admin@pragma.test',
      password: 'secret',
    });

    expect(session.user.id).toBe('crm-id');
    expect(session.accessToken).toBe('access');
    expect(revokeMock).not.toHaveBeenCalled();
  });

  it('revokes the GoTrue session when the CRM user is disabled', async () => {
    signInMock.mockResolvedValue(goTrue);
    findUserMock.mockResolvedValue({ ...record, active: false });
    revokeMock.mockResolvedValue(undefined);

    await expect(
      establishSession(client, { email: 'admin@pragma.test', password: 'secret' })
    ).rejects.toEqual(CustomError.forbidden('The user is disabled'));

    expect(revokeMock).toHaveBeenCalledWith('access');
  });
});
