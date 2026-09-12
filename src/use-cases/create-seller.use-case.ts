import { Client } from '../lib/prisma';
import { logger } from '../lib/adapters/logger';
import { CreateSellerInput } from '../domain/schemas/seller.schema';
import {
  createSellerProfile,
  SellerRecord,
} from '../services/seller.service';
import {
  createSellerAuthUser,
  deleteAuthUser,
  sendLoginOtp,
} from '../services/supabaseAdmin.service';

export interface CreatedSeller {
  seller: SellerRecord;
}

// Identity first, profile second: the insert already knows auth_user_id, so
// there is no window where a seller exists in the CRM without an account and
// somebody has to link the two by hand.
export const createSeller = async (
  client: Client,
  data: CreateSellerInput
): Promise<CreatedSeller> => {
  const { authUserId } = await createSellerAuthUser(data.email);

  try {
    const seller = await createSellerProfile(client, data, authUserId);

    await sendLoginOtp(data.email).catch((error) => {
      logger.error('Could not send the onboarding OTP after creating the seller', {
        seller_id: seller.id,
        email: data.email,
        error,
      });
    });

    return { seller };
  } catch (error) {
    await deleteAuthUser(authUserId).catch((cleanupError) => {
      logger.error('Could not roll back the auth account after the profile failed', {
        auth_user_id: authUserId,
        cleanup_error: cleanupError,
      });
    });
    throw error;
  }
};
