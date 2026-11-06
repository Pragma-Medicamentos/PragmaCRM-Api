import { NextFunction, Request, Response } from 'express';
import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';
import { CustomError } from '../../domain/errors/CustomError';
import { logger } from '../../lib/adapters/logger';

/**
 * Rate limits for the API (PCRM-138). Numbers and the client usage that
 * justifies them are in docs/SECURITY.md; tune them from the
 * 'Rate limit exceeded' warnings, not by guessing.
 *
 * The client IP comes from X-Forwarded-For through `trust proxy` (server.ts),
 * which is set to the single proxy (Traefik) in front of the app.
 *
 * The store is in memory: the API runs as a single instance on the VPS. A
 * second instance would need a shared store, or each would count on its own.
 */

const MINUTE = 60 * 1000;

/**
 * Per-IP limits for the public auth routes. Every login reaches GoTrue from
 * this server's IP, so Supabase's own per-IP limits cannot tell an attacker
 * from the rest of the team: without a limit here, one client guessing
 * passwords would exhaust Supabase's quota and lock everyone out. And /otp
 * sends an email per call.
 */
export const AUTH_RATE_LIMITS = {
  otp: { limit: 5, windowMs: 15 * MINUTE },
  login: { limit: 10, windowMs: 15 * MINUTE },
  refresh: { limit: 60, windowMs: 15 * MINUTE },
} as const;

/**
 * Limits for the rest of the API. Neither client caches, so every reload,
 * tab switch or filter change repeats all of a screen's calls; these are sized
 * so that never trips and only a script or a loop does.
 *
 * - global: every /api/v1 request, per IP. The worst honest burst is the web
 *   route planner (9 + one call per active route, repeated on every drag), and
 *   the whole office may share one IP. The one-minute window caps a lockout
 *   at a minute.
 * - reports / uploads: per user, the two endpoints that cost real CPU and
 *   memory. Downloading all ~28 reports in a row fits; a loop does not.
 */
export const API_RATE_LIMITS = {
  global: { limit: 1200, windowMs: MINUTE },
  reports: { limit: 30, windowMs: 5 * MINUTE },
  uploads: { limit: 10, windowMs: 15 * MINUTE },
} as const;

export type AuthRateLimitName = keyof typeof AUTH_RATE_LIMITS;
export type ApiRateLimitName = keyof typeof API_RATE_LIMITS;

interface Options {
  limit: number;
  windowMs: number;
  /** Lets the route-level tests exercise the routes without tripping the limit. */
  skip?: () => boolean;
  /** Defaults to the client IP. */
  keyGenerator?: (req: Request) => string;
}

export const createRateLimiter = (
  name: string,
  { limit, windowMs, skip, keyGenerator }: Options
): RateLimitRequestHandler =>
  rateLimit({
    limit,
    windowMs,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: skip ? () => skip() : undefined,
    ...(keyGenerator && { keyGenerator: (req: Request) => keyGenerator(req) }),
    // Delegates to the global error handler so the 429 keeps the ApiResponse
    // envelope instead of the library's plain-text body.
    handler: (req: Request, res: Response, next: NextFunction) => {
      logger.warn('Rate limit exceeded', {
        limiter: name,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        user_id: req.authUser?.id,
        request_id: res.getHeader('X-Request-ID'),
      });
      next(new CustomError('Too many requests, try again later', 429));
    },
  });

// Jest sets NODE_ENV=test. The limiter itself is covered in
// middleware/__tests__/rateLimit.test.ts.
const skipInTests = () => process.env.NODE_ENV === 'test';

/**
 * Per authenticated user, so two people behind the office IP do not share a
 * budget. Only mounted after requireAuth; the IP fallback is defensive.
 */
export const userKey = (req: Request): string =>
  req.authUser?.id ?? req.ip ?? 'unknown';

export const authRateLimiter = (name: AuthRateLimitName): RateLimitRequestHandler =>
  createRateLimiter(`auth.${name}`, {
    ...AUTH_RATE_LIMITS[name],
    skip: skipInTests,
  });

export const apiRateLimiter = (name: ApiRateLimitName): RateLimitRequestHandler =>
  createRateLimiter(`api.${name}`, {
    ...API_RATE_LIMITS[name],
    skip: skipInTests,
    keyGenerator: name === 'global' ? undefined : userKey,
  });
