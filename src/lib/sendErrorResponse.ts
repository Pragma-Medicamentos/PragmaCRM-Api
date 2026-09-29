import { Response } from 'express';
import { ApiResponse } from '../domain/interfaces';
import { handleError } from './handleError';
import { logger } from './adapters/logger';

/**
 * Single exit point for errors in controllers. Translates the error, logs only
 * the unexpected ones (500) and replies with the ApiResponse envelope.
 */
export const sendErrorResponse = (
  res: Response,
  error: unknown,
  context?: string
): void => {
  const { statusCode, message, code } = handleError(error);

  if (statusCode === 500) {
    logger.error(`Unexpected error${context ? ` in ${context}` : ''}`, {
      error,
    });
  }

  res
    .status(statusCode)
    .json({ success: false, message, ...(code ? { code } : {}) } satisfies ApiResponse);
};
