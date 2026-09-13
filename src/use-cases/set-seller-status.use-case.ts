import { Client } from '../lib/prisma';
import { logger } from '../lib/adapters/logger';
import { setSellerStatus, SellerRecord } from '../services/seller.service';
import { setAuthUserBanned } from '../services/supabaseAdmin.service';

// RLS already hides every row from a disabled seller, because the app_auth
// helpers filter by active. Banning is what kills the live session: without it
// the seller keeps a usable access token until it expires.
export const setSellerStatusEverywhere = async (
  client: Client,
  id: string,
  active: boolean
): Promise<SellerRecord> => {
  const seller = await setSellerStatus(client, id, active);

  if (seller.auth_user_id) {
    // The CRM flag is the source of truth; a failure here degrades how fast the
    // session dies, it does not leave the seller with access.
    await setAuthUserBanned(seller.auth_user_id, !active).catch((error) => {
      logger.error('Could not sync the ban state with Supabase Auth', {
        seller_id: seller.id,
        active,
        error,
      });
    });
  }

  return seller;
};
