import { NextFunction, Request, Response } from 'express';
import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';
import { CustomError } from '../../domain/errors/CustomError';
import { logger } from '../../lib/adapters/logger';

/**
 * Per-IP limits for the public auth routes (PCRM-138).
 *
 * They exist for two reasons. Every login reaches GoTrue from this server's
 * IP, so Supabase's own per-IP limits cannot tell an attacker from the rest of
 * the team: without a limit here, one client guessing passwords would exhaust
 * Supabase's quota and lock everyone out. And /otp sends an email per call.
 *
 * The client IP comes from X-Forwarded-For through `trust proxy` (server.ts),
 * which is set to the single proxy (Traefik) in front of the app.
 *
 * The store is in memory: the API runs as a single instance on the VPS. A
 * second instance would need a shared store, or each would count on its own.
 */
export const AUTH_RATE_LIMITS = {
  otp: { limit: 5, windowMs: 15 * 60 * 1000 },
  login: { limit: 10, windowMs: 15 * 60 * 1000 },
  refresh: { limit: 60, windowMs: 15 * 60 * 1000 },
} as const;

export type AuthRateLimitName = keyof typeof AUTH_RATE_LIMITS;

interface Options {
  limit: number;
  windowMs: number;
  /** Lets the route-level tests exercise the auth routes without tripping the limit. */
  skip?: () => boolean;
}

export const createRateLimiter = (
  name: string,
  { limit, windowMs, skip }: Options
): RateLimitRequestHandler =>
  rateLimit({
    limit,
    windowMs,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: skip ? () => skip() : undefined,
    // Delegates to the global error handler so the 429 keeps the ApiResponse
    // envelope instead of the library's plain-text body.
    handler: (req: Request, res: Response, next: NextFunction) => {
      logger.warn('Rate limit exceeded', {
        limiter: name,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        request_id: res.getHeader('X-Request-ID'),
      });
      next(new CustomError('Too many requests, try again later', 429));
    },
  });

export const authRateLimiter = (name: AuthRateLimitName): RateLimitRequestHandler =>
  createRateLimiter(`auth.${name}`, {
    ...AUTH_RATE_LIMITS[name],
    // Jest sets NODE_ENV=test. The limiter itself is covered in
    // middleware/__tests__/rateLimit.test.ts.
    skip: () => process.env.NODE_ENV === 'test',
  });
