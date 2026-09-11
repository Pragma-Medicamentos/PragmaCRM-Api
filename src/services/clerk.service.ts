import { clerkClient } from '@clerk/express';
import { CustomError } from '../domain/errors/CustomError';

// Duck-typing en vez de isClerkAPIResponseError: ese helper vive en
// @clerk/backend/errors, que no es dependencia directa de este repo.
const isDuplicateIdentifierError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object' || !('errors' in error)) return false;

  const errors = (error as { errors?: unknown }).errors;
  
  if (!Array.isArray(errors)) return false;
  
  return errors.some(
    (e) =>
      e &&
      typeof e === 'object' &&
      'code' in e &&
      (e as { code?: unknown }).code === 'form_identifier_exists'
  );
};

// No se fija redirectUrl: la API aun no tiene URL publica con HTTPS desplegada.
// Clerk usa el destino configurado en el dashboard de la instancia.
export const inviteSeller = async (email: string): Promise<void> => {
  try {
    await clerkClient.invitations.createInvitation({ emailAddress: email });
  } catch (error) {
    if (isDuplicateIdentifierError(error)) {
      throw CustomError.conflict(
        'Ya existe una invitación o cuenta de Clerk con este correo'
      );
    }
    
    throw error;
  }
};
