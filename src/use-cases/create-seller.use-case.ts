import { Client } from '../lib/prisma';
import { logger } from '../lib/adapters/logger';
import { CreateSellerInput } from '../domain/schemas/seller.schema';
import {
  createSellerProfile,
  deleteSellerProfile,
  SellerRecord,
} from '../services/seller.service';
import { inviteSeller } from '../services/clerk.service';

// clerk_user_id queda en NULL hasta que el vendedor acepte la invitacion y se
// enlace manualmente (ver 8.1: el webhook user.created/user.updated esta
// fuera de alcance — la API aun no tiene URL publica con HTTPS).
export const createSeller = async (
  client: Client,
  data: CreateSellerInput
): Promise<SellerRecord> => {
  const seller = await createSellerProfile(client, data);

  try {
    await inviteSeller(seller.email as string);
  } catch (error) {
    // Compensacion: sin invitacion no hay forma de que el vendedor acceda,
    // no dejamos un perfil huerfano en el CRM.
    await deleteSellerProfile(client, seller.id).catch((cleanupError) => {
      logger.error('No se pudo revertir el perfil tras fallar la invitación de Clerk', {
        seller_id: seller.id,
        cleanup_error: cleanupError,
      });
    });
    throw error;
  }

  return seller;
};
