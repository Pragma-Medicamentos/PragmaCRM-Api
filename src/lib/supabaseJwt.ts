import {
  createRemoteJWKSet,
  jwtVerify,
  JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import { envs } from '../config/envs';
import { CustomError } from '../domain/errors/CustomError';

export interface SupabaseClaims {
  /** auth.users.id — resolved against app_user.auth_user_id. */
  sub: string;
  email?: string;
}

// Thrown when the JWKS itself is unreachable. That is not a bad token, so it
// must not become a 401: sending everyone back to the login screen over a
// network blip is worse than admitting the API is degraded.
export class JwksUnavailableError extends Error {}

const issuer = () =>
  `${envs.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1`;

let keySet: JWTVerifyGetKey | undefined;

// Lazy so importing this module never performs I/O, and so tests can inject a
// local key set built with jose's createLocalJWKSet.
const getKeySet = (): JWTVerifyGetKey => {
  keySet ??= createRemoteJWKSet(new URL(`${issuer()}/.well-known/jwks.json`));
  return keySet;
};

export const setKeySetForTesting = (custom?: JWTVerifyGetKey): void => {
  keySet = custom;
};

const isJwksFailure = (error: unknown): boolean => {
  const code = (error as { code?: string })?.code ?? '';
  return (
    code === 'ERR_JWKS_TIMEOUT' ||
    code === 'ERR_JWKS_NO_MATCHING_KEY' ||
    code === 'ERR_JWKS_MULTIPLE_MATCHING_KEYS' ||
    error instanceof TypeError
  );
};

/**
 * Verifies a Supabase access token against the project's asymmetric JWKS.
 *
 * The issuer check matters: without it, a
 * token minted by any other Supabase project would be accepted here.
 */
export const verifyAccessToken = async (
  token: string
): Promise<SupabaseClaims> => {
  let payload: JWTPayload;

  try {
    ({ payload } = await jwtVerify(token, getKeySet(), {
      issuer: issuer(),
      audience: 'authenticated',
      clockTolerance: '5s',
    }));
  } catch (error) {
    if (isJwksFailure(error)) {
      throw new JwksUnavailableError((error as Error).message);
    }
    throw CustomError.unauthorized('Invalid or expired session');
  }

  if (payload.is_anonymous === true) {
    throw CustomError.unauthorized('Anonymous sessions are not accepted');
  }

  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw CustomError.unauthorized('Invalid or expired session');
  }

  // payload.role is the Postgres role ('authenticated'), never the CRM role:
  // that one lives in app_user and is resolved by requireAuth.
  return {
    sub: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
  };
};

/** Warms the JWKS cache so the first real request does not pay the fetch. */
export const warmUpJwks = async (): Promise<void> => {
  try {
    await fetch(`${issuer()}/.well-known/jwks.json`);
  } catch {
    // Best effort: verifyAccessToken retries and reports 503 if it matters.
  }
};
