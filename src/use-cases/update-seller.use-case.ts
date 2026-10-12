import { Client } from '../lib/prisma';
import { logger } from '../lib/adapters/logger';
import { UpdateSellerInput } from '../domain/schemas/seller.schema';
import { getSellerById, SellerRecord, updateSeller } from '../services/seller.service';
import { sendLoginOtp, updateAuthUserEmail } from '../services/supabaseAdmin.service';
import { setSellerStatusEverywhere } from './set-seller-status.use-case';

/**
 * Outcome of the onboarding email (PCRM-182). `null` when the update was not a
 * first email assignment, so nothing had to be sent.
 */
export type AccessEmailStatus = 'sent' | 'failed' | null;

export interface UpdatedSeller {
  seller: SellerRecord;
  accessEmail: AccessEmailStatus;
}

// An email change has to reach Supabase Auth too: sellers auto-created by the
// ERP import start with a placeholder address there, and the OTP is sent to the
// auth account's email, not to `app_user.email`.
export const updateSellerEverywhere = async (
  client: Client,
  id: string,
  data: UpdateSellerInput
): Promise<UpdatedSeller> => {
  const before = await getSellerById(client, id);
  const seller = await updateSeller(client, id, data);

  if (data.email !== undefined && seller.auth_user_id && data.email !== before.email) {
    try {
      await updateAuthUserEmail(seller.auth_user_id, data.email);
    } catch (error) {
      // Keep both stores consistent: restore the previous profile email.
      await client.app_user.update({
        where: { id },
        data: { email: before.email },
      });
      throw error;
    }
  }

  // Only sellers from the ERP import reach this point without an email: the
  // manual create requires one. Their first email is what makes the account
  // usable, so the import's ban is lifted here and the onboarding OTP goes out.
  const isFirstEmail = data.email !== undefined && before.email === null;
  if (!isFirstEmail) return { seller, accessEmail: null };

  if (!seller.auth_user_id) {
    logger.error('Seller from the ERP import has no auth account to send the access email', {
      seller_id: seller.id,
    });
    return { seller, accessEmail: 'failed' };
  }

  const enabled = await setSellerStatusEverywhere(client, id, true);

  // The email is already saved; a failed send must not roll it back. The admin
  // sees the warning and can use resend-otp.
  const accessEmail = await sendLoginOtp(data.email as string).then(
    (): AccessEmailStatus => 'sent',
    (error): AccessEmailStatus => {
      logger.error('Could not send the access email after assigning the seller email', {
        seller_id: seller.id,
        error,
      });
      return 'failed';
    }
  );

  return { seller: enabled, accessEmail };
};
