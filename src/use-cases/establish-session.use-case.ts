import { Client } from '../lib/prisma';
import { CustomError } from '../domain/errors/CustomError';
import { LoginInput } from '../domain/schemas/auth.schema';
import { AuthenticatedUser, isRole } from '../domain/types/auth.types';
import { findUserByAuthUserId } from '../services/auth.service';
import { logger } from '../lib/adapters/logger';
import {
  GoTrueSession,
  refreshSession,
  revokeSession,
  signInWithPassword,
  verifyEmailOtp,
} from '../services/supabaseSession.service';

export interface EstablishedSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthenticatedUser;
}

const toAuthenticatedUser = (
  record: NonNullable<Awaited<ReturnType<typeof findUserByAuthUserId>>>,
  authUserId: string
): AuthenticatedUser => {
  if (!isRole(record.role)) {
    throw CustomError.forbidden('The user does not have a valid role');
  }

  return {
    id: record.id,
    authUserId,
    role: record.role,
    name: record.name,
    email: record.email,
    passwordSetAt: record.password_set_at?.toISOString() ?? null,
  };
};

/**
 * A GoTrue session for someone who is not an active CRM user must not be left
 * alive: the cookies are never set, and the refresh token is revoked.
 */
const assertCrmUser = async (
  client: Client,
  session: GoTrueSession
): Promise<AuthenticatedUser> => {
  const record = await findUserByAuthUserId(client, session.authUserId);

  if (!record || !record.active) {
    await revokeSession(session.accessToken).catch((error: unknown) => {
      logger.warn('Failed to revoke a rejected login session', { error });
    });
  }

  if (!record) {
    throw CustomError.forbidden('The user is not registered in the CRM');
  }

  if (!record.active) {
    throw CustomError.forbidden('The user is disabled');
  }

  return toAuthenticatedUser(record, session.authUserId);
};

const pack = (
  session: GoTrueSession,
  user: AuthenticatedUser
): EstablishedSession => ({
  accessToken: session.accessToken,
  refreshToken: session.refreshToken,
  expiresIn: session.expiresIn,
  user,
});

export const establishSession = async (
  client: Client,
  input: LoginInput
): Promise<EstablishedSession> => {
  const session =
    'password' in input
      ? await signInWithPassword(input.email, input.password)
      : await verifyEmailOtp(input.email, input.otp);

  const user = await assertCrmUser(client, session);
  return pack(session, user);
};

export const refreshEstablishedSession = async (
  client: Client,
  refreshToken: string
): Promise<EstablishedSession> => {
  const session = await refreshSession(refreshToken);
  const user = await assertCrmUser(client, session);
  return pack(session, user);
};
