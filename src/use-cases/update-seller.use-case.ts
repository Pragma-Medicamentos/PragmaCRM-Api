import { Client } from '../lib/prisma';
import { UpdateSellerInput } from '../domain/schemas/seller.schema';
import { getSellerById, SellerRecord, updateSeller } from '../services/seller.service';
import { updateAuthUserEmail } from '../services/supabaseAdmin.service';

// An email change has to reach Supabase Auth too: sellers auto-created by the
// ERP import start with a placeholder address there, and the OTP is sent to the
// auth account's email, not to `app_user.email`.
export const updateSellerEverywhere = async (
  client: Client,
  id: string,
  data: UpdateSellerInput
): Promise<SellerRecord> => {
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

  return seller;
};
