import { CookieOptions, Request, Response } from 'express';
import { envs } from '../config/envs';

/** Access JWT. Sent on every `/api/v1` call so `requireAuth` can read it. */
export const ACCESS_COOKIE = 'pcrm_access';

/**
 * Refresh token. Scoped to the auth routes so it is not attached to ordinary
 * CRM calls (customers, uploads, metrics).
 */
export const REFRESH_COOKIE = 'pcrm_refresh';

export const ACCESS_COOKIE_PATH = '/api/v1';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/**
 * GoTrue does not expire refresh tokens unless `[auth.sessions].timebox` is
 * set (it is not, locally or in the hosted projects this API talks to). The
 * cookie is the browser-side bound: after 30 days the dashboard must sign in
 * again even if the refresh token would still be accepted.
 */
export const REFRESH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const sameSite = (): CookieOptions['sameSite'] => envs.AUTH_COOKIE_SAMESITE;

const secureCookie = (): boolean =>
  envs.AUTH_COOKIE_SAMESITE === 'none' || envs.STAGE !== 'dev';

const baseOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: secureCookie(),
  sameSite: sameSite(),
});

const readCookieHeader = (header: string | undefined, name: string): string | undefined => {
  if (!header) return undefined;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;

    const key = part.slice(0, separator).trim();
    if (key !== name) continue;

    const raw = part.slice(separator + 1).trim();
    if (raw.length === 0) return undefined;

    try {
      return decodeURIComponent(raw);
    } catch {
      return undefined;
    }
  }

  return undefined;
};

export const readAccessCookie = (req: Request): string | undefined =>
  readCookieHeader(req.headers.cookie, ACCESS_COOKIE);

export const readRefreshCookie = (req: Request): string | undefined =>
  readCookieHeader(req.headers.cookie, REFRESH_COOKIE);

export const setSessionCookies = (res: Response, tokens: SessionTokens): void => {
  const base = baseOptions();
  const accessMaxAge = Math.max(1, Math.floor(tokens.expiresIn));

  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base,
    path: ACCESS_COOKIE_PATH,
    maxAge: accessMaxAge * 1000,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base,
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS * 1000,
  });
};

/** Clears both cookies. Options must match the ones used when they were set. */
export const clearSessionCookies = (res: Response): void => {
  const base = baseOptions();
  res.clearCookie(ACCESS_COOKIE, { ...base, path: ACCESS_COOKIE_PATH });
  res.clearCookie(REFRESH_COOKIE, { ...base, path: REFRESH_COOKIE_PATH });
};
