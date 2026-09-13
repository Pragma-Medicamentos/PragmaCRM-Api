import { Client } from '../lib/prisma';
import { CustomError } from '../domain/errors/CustomError';
import { getSellerById, SellerRecord } from '../services/seller.service';
import { sendLoginOtp } from '../services/supabaseAdmin.service';

export const resendSellerOtp = async (
  client: Client,
  id: string
): Promise<SellerRecord> => {
  const seller = await getSellerById(client, id);

  if (!seller.active) {
    throw CustomError.conflict(
      'Habilite al vendedor antes de reenviar el codigo de acceso'
    );
  }

  if (!seller.email) {
    throw CustomError.conflict('El vendedor no tiene correo registrado');
  }

  if (!seller.auth_user_id) {
    throw CustomError.conflict(
      'El vendedor no tiene cuenta de acceso vinculada'
    );
  }

  await sendLoginOtp(seller.email);

  return seller;
};
