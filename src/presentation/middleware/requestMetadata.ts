import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { logger } from '../../lib/adapters/logger';

/**
 * Assigns an X-Request-ID to every request and logs method, path, status and
 * duration once the response finishes. It is the first middleware in the chain
 * so the id is available to every other layer.
 */
export const requestMetadata = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const requestId = randomUUID();
  const startAt = process.hrtime.bigint();

  res.setHeader('X-Request-ID', requestId);

  res.on('finish', () => {
    const elapsed = Number(process.hrtime.bigint() - startAt) / 1_000_000;
    logger.info('Request completed', {
      method: req.method,
      // originalUrl rather than req.path: Express rewrites req.url when it
      // enters a mounted router, and this callback runs after routing — req.path
      // would already be relative to the router ("/" instead of "/api/health").
      // The query string is trimmed to avoid logging sensitive data.
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      duration_ms: elapsed.toFixed(2),
      request_id: requestId,
    });
  });

  next();
};
