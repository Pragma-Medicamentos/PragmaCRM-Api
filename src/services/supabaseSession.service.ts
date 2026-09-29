import { envs } from '../config/envs';
import { CustomError } from '../domain/errors/CustomError';

export interface GoTrueSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  authUserId: string;
}

interface GoTrueTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: { id?: string };
}

const authBase = (): string =>
  `${envs.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1`;

const authHeaders = (accessToken?: string): Record<string, string> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: envs.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${accessToken ?? envs.SUPABASE_SERVICE_ROLE_KEY}`,
  };
  return headers;
};

const readErrorMessage = async (response: Response): Promise<string> => {
  const body = (await response.json().catch(() => ({}))) as {
    msg?: string;
    error_description?: string;
    message?: string;
  };
  return body.msg ?? body.error_description ?? body.message ?? '';
};

const parseSession = (body: GoTrueTokenResponse): GoTrueSession => {
  const authUserId = body.user?.id;
  if (
    !body.access_token ||
    !body.refresh_token ||
    typeof authUserId !== 'string' ||
    authUserId.length === 0
  ) {
    throw new Error('Supabase Auth returned a session without tokens');
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresIn: typeof body.expires_in === 'number' ? body.expires_in : 3600,
    authUserId,
  };
};

/**
 * Password and OTP grants use the service role as `apikey`, the same way
 * `sendLoginOtp` does. There is no anon key in this service's environment.
 * A 4xx from GoTrue is an authentication failure; anything else is a 500.
 */
const requestSession = async (
  url: string,
  body: unknown,
  invalidMessage: string
): Promise<GoTrueSession> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    if (response.status >= 400 && response.status < 500) {
      throw CustomError.unauthorized(invalidMessage);
    }
    const detail = await readErrorMessage(response);
    throw new Error(
      detail || `Supabase Auth failed with status ${response.status}`
    );
  }

  const payload = (await response.json()) as GoTrueTokenResponse;
  return parseSession(payload);
};

export const signInWithPassword = (
  email: string,
  password: string
): Promise<GoTrueSession> =>
  requestSession(
    `${authBase()}/token?grant_type=password`,
    { email, password },
    'Invalid email or password'
  );

export const verifyEmailOtp = (
  email: string,
  token: string
): Promise<GoTrueSession> =>
  requestSession(
    `${authBase()}/verify`,
    { email, token, type: 'email' },
    'Invalid or expired code'
  );

export const refreshSession = (refreshToken: string): Promise<GoTrueSession> =>
  requestSession(
    `${authBase()}/token?grant_type=refresh_token`,
    { refresh_token: refreshToken },
    'Invalid or expired session'
  );

/** Best-effort. A failed revoke must not keep the browser cookies alive. */
export const revokeSession = async (accessToken: string): Promise<void> => {
  const response = await fetch(`${authBase()}/logout`, {
    method: 'POST',
    headers: authHeaders(accessToken),
  });

  if (!response.ok && response.status !== 401 && response.status !== 403) {
    const detail = await readErrorMessage(response);
    throw new Error(detail || `Supabase logout failed with status ${response.status}`);
  }
};
