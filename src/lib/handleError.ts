import { ZodError } from 'zod';
import { CustomError } from '../domain/errors/CustomError';
import { ErrorHandlerInterface } from '../domain/errors/errorHandler.interface';

/**
 * Traduce cualquier error que llegue desde los servicios/controladores a un par
 * { statusCode, message } seguro para el cliente. Es el unico lugar donde se
 * decide que significa un fallo de cara a la API, de modo que controladores y
 * middlewares no repitan esa logica.
 */
export const handleError = (error: unknown): ErrorHandlerInterface => {
  let statusCode = 500;
  let message = 'Internal server error';

  if (error instanceof CustomError) {
    statusCode = error.statusCode;
    message = error.message;
  } else if (error instanceof ZodError) {
    statusCode = 400;
    message = error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ');
  } else if (
    error &&
    typeof error === 'object' &&
    'expose' in error &&
    (error as { expose?: unknown }).expose === true
  ) {
    // Errores de middlewares de Express (p. ej. body-parser con JSON malformado)
    // marcan `expose: true` cuando el mensaje es seguro de mostrar al cliente.
    const httpErr = error as {
      statusCode?: number;
      status?: number;
      message?: string;
    };
    const code = httpErr.statusCode ?? httpErr.status ?? 500;
    if (code >= 400 && code < 500) {
      statusCode = code;
      message = httpErr.message ?? message;
    }
  } else if (error && typeof error === 'object' && 'code' in error) {
    // Codigos de error conocidos de Prisma.
    const prismaCode = String((error as { code?: unknown }).code ?? '');
    if (prismaCode === 'P2002') {
      statusCode = 409;
      message = 'Duplicate record.';
    } else if (prismaCode === 'P2003') {
      statusCode = 400;
      message = 'Reference error: one or more related records do not exist.';
    } else if (prismaCode === 'P2025') {
      statusCode = 404;
      message = 'Record not found.';
    }
  }

  return { statusCode, message };
};
