import { Response } from 'express';
import { ApiResponse } from '../domain/interfaces';
import { handleError } from './handleError';
import { logger } from './adapters/logger';

/**
 * Punto unico de salida de errores en los controladores. Traduce el error,
 * loguea solo lo inesperado (500) y responde con el envelope ApiResponse.
 */
export const sendErrorResponse = (
  res: Response,
  error: unknown,
  context?: string
): void => {
  const { statusCode, message } = handleError(error);

  if (statusCode === 500) {
    logger.error(`Unexpected error${context ? ` in ${context}` : ''}`, {
      error,
    });
  }

  res
    .status(statusCode)
    .json({ success: false, message } satisfies ApiResponse);
};
