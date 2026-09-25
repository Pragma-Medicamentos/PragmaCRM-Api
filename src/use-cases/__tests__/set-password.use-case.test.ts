import { ROLES } from '../../domain/types/auth.types';
import {
  findUserByAuthUserId,
  stampPasswordSetAt,
} from '../../services/auth.service';
import { setAuthUserPassword } from '../../services/supabaseAdmin.service';
import { setUserPassword } from '../set-password.use-case';

jest.mock('../../services/auth.service', () => ({
  findUserByAuthUserId: jest.fn(),
  stampPasswordSetAt: jest.fn(),
}));

jest.mock('../../services/supabaseAdmin.service', () => ({
  setAuthUserPassword: jest.fn(),
}));

const findUserMock = findUserByAuthUserId as jest.Mock;
const stampMock = stampPasswordSetAt as jest.Mock;
const setAuthPasswordMock = setAuthUserPassword as jest.Mock;

const user = {
  id: 'crm-id',
  authUserId: 'auth-id',
  role: ROLES.ADMIN,
  name: 'Admin',
  email: 'admin@pragma.test',
  passwordSetAt: null,
};

describe('setUserPassword', () => {
  const client = {} as never;

  it('updates GoTrue and stamps password_set_at when the column is still null', async () => {
    const stamped = new Date('2026-09-25T15:00:00.000Z');
    setAuthPasswordMock.mockResolvedValue(undefined);
    stampMock.mockResolvedValue({ count: 1 });
    findUserMock.mockResolvedValue({
      id: 'crm-id',
      auth_user_id: 'auth-id',
      role: ROLES.ADMIN,
      name: 'Admin',
      email: 'admin@pragma.test',
      active: true,
      password_set_at: stamped,
    });

    const result = await setUserPassword(client, user, 'new-secret');

    expect(setAuthPasswordMock).toHaveBeenCalledWith('auth-id', 'new-secret');
    expect(stampMock).toHaveBeenCalledWith(client, 'crm-id', expect.any(Date));
    expect(result.passwordSetAt).toBe(stamped.toISOString());
    expect(result).not.toHaveProperty('accessToken');
    expect(result).not.toHaveProperty('refreshToken');
  });
});
