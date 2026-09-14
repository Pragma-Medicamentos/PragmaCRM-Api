import { Client } from '../lib/prisma';

export interface AppUserRecord {
  id: string;
  auth_user_id: string | null;
  role: string;
  name: string;
  email: string | null;
  active: boolean;
  password_set_at: Date | null;
}

// findFirst and not findUnique: the unique index is partial (WHERE deleted_at IS NULL).
export const findUserByAuthUserId = (
  client: Client,
  authUserId: string
): Promise<AppUserRecord | null> =>
  client.app_user.findFirst({
    where: { auth_user_id: authUserId, deleted_at: null },
    select: {
      id: true,
      auth_user_id: true,
      role: true,
      name: true,
      email: true,
      active: true,
      password_set_at: true,
    },
  });

export const findActiveUserByEmail = (
  client: Client,
  email: string
): Promise<AppUserRecord | null> =>
  client.app_user.findFirst({
    where: { email, deleted_at: null, active: true },
    select: {
      id: true,
      auth_user_id: true,
      role: true,
      name: true,
      email: true,
      active: true,
      password_set_at: true,
    },
  });
