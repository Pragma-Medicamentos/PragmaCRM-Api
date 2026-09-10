import { Client } from '../lib/prisma';

export interface AppUserRecord {
  id: string;
  clerk_user_id: string | null;
  role: string;
  name: string;
  email: string | null;
  active: boolean;
}

// findFirst y no findUnique: el indice unico es parcial (WHERE deleted_at IS NULL).
export const findUserByClerkId = (
  client: Client,
  clerkUserId: string
): Promise<AppUserRecord | null> =>
  client.app_user.findFirst({
    where: { clerk_user_id: clerkUserId, deleted_at: null },
    select: {
      id: true,
      clerk_user_id: true,
      role: true,
      name: true,
      email: true,
      active: true,
    },
  });
