import { Client } from '../lib/prisma';
import { CustomError } from '../domain/errors/CustomError';
import { findActiveUserByEmail } from '../services/auth.service';
import { sendLoginOtp } from '../services/supabaseAdmin.service';

export const requestLoginOtp = async (
  client: Client,
  email: string
): Promise<void> => {
  const user = await findActiveUserByEmail(client, email);

  if (!user) {
    throw CustomError.notFound('No hay una cuenta activa con este correo');
  }

  if (!user.auth_user_id) {
    throw CustomError.conflict('La cuenta no tiene acceso configurado');
  }

  await sendLoginOtp(email);
};
