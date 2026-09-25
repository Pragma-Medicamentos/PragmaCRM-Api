import { Client } from '../lib/prisma';
import { CustomError } from '../domain/errors/CustomError';
import { AuthenticatedUser } from '../domain/types/auth.types';
import {
  findUserByAuthUserId,
  stampPasswordSetAt,
} from '../services/auth.service';
import { setAuthUserPassword } from '../services/supabaseAdmin.service';

/**
 * Writes the password in GoTrue first. The DB trigger stamps
 * `password_set_at` on that update; if it did not (trigger missing, or the
 * column was still null), the API writes it so `/me` can see the change.
 */
export const setUserPassword = async (
  client: Client,
  user: AuthenticatedUser,
  password: string
): Promise<AuthenticatedUser> => {
  await setAuthUserPassword(user.authUserId, password);

  const at = new Date();
  await stampPasswordSetAt(client, user.id, at);

  const record = await findUserByAuthUserId(client, user.authUserId);
  if (!record) {
    throw CustomError.forbidden('The user is not registered in the CRM');
  }

  return {
    ...user,
    passwordSetAt: record.password_set_at?.toISOString() ?? at.toISOString(),
  };
};
