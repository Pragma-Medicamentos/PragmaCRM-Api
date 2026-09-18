import { timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { envs } from '../../config/envs';
import { CustomError } from '../../domain/errors/CustomError';
import { logger } from '../../lib/adapters/logger';

const matches = (provided: string, expected: string): boolean => {
  // Buffer is typed as Uint8Array<ArrayBufferLike> and timingSafeEqual
  // expects ArrayBufferView; copying into a fresh Uint8Array resolves it.
  const a = new Uint8Array(Buffer.from(provided));
  const b = new Uint8Array(Buffer.from(expected));
  return a.length === b.length && timingSafeEqual(a, b);
};

export const requireApiKey = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const provided = req.headers['x-api-key'];
  const valid =
    typeof provided === 'string' && matches(provided, envs.API_KEY);

  if (!valid) {
    logger.warn('Invalid or missing API key', {
      method: req.method,
      path: req.originalUrl.split('?')[0],
      request_id: res.getHeader('X-Request-ID'),
    });
    return next(CustomError.unauthorized('Invalid or missing API key'));
  }

  next();
};