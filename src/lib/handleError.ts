import { ZodError } from 'zod';
import { CustomError } from '../domain/errors/CustomError';
import { ErrorHandlerInterface } from '../domain/errors/errorHandler.interface';

/**
 * Translates any error coming from services or controllers into a
 * { statusCode, message } pair that is safe to hand to the client. It is the
 * single place where a failure's meaning is decided for the API, so
 * controllers and middlewares do not repeat that logic.
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
    // Express middleware errors (body-parser on malformed JSON, for instance)
    // set `expose: true` when the message is safe to show to the client.
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
    // Known Prisma error codes.
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
