import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { envs } from '../config/envs';
import { CustomError } from '../domain/errors/CustomError';

let client: SupabaseClient | undefined;

// Lazy: instantiating at module load would break every test that imports the
// sellers chain before the env is populated.
const admin = (): SupabaseClient => {
  client ??= createClient(envs.SUPABASE_URL, envs.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
};

export interface CreatedAuthUser {
  authUserId: string;
}

/**
 * Creates a confirmed auth account with no password. The seller completes
 * onboarding from the app: OTP verify, then updateUser({ password }).
 */
export const createSellerAuthUser = async (
  email: string
): Promise<CreatedAuthUser> => {
  const { data, error } = await admin().auth.admin.createUser({
    email,
    email_confirm: true,
  });

  if (error) {
    if (error.code === 'email_exists') {
      throw CustomError.conflict('Ya existe una cuenta de acceso con este correo');
    }
    throw error;
  }

  return { authUserId: data.user.id };
};

/**
 * Sends a 6-digit OTP to an existing auth account. Uses the service role so
 * sign-in works with enable_signup = false: only accounts created by the API
 * can receive a code.
 */
export const sendLoginOtp = async (email: string): Promise<void> => {
  const response = await fetch(`${envs.SUPABASE_URL}/auth/v1/otp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: envs.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${envs.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ email, create_user: false }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error_code?: string;
      msg?: string;
    };

    if (body.error_code === 'otp_disabled') {
      throw CustomError.internal('El inicio de sesion por correo no esta habilitado');
    }

    throw new Error(body.msg ?? `OTP request failed with status ${response.status}`);
  }
};

export const getAuthUserById = async (authUserId: string) => {
  const { data, error } = await admin().auth.admin.getUserById(authUserId);
  if (error) throw error;
  return data.user;
};

/** Compensation when the CRM profile fails to insert. */
export const deleteAuthUser = async (authUserId: string): Promise<void> => {
  const { error } = await admin().auth.admin.deleteUser(authUserId);
  if (error) throw error;
};

/**
 * RLS already hides everything from a disabled seller, because the app_auth
 * helpers filter by active. Banning additionally kills the refresh, so the
 * session dies instead of lingering until the access token expires.
 */
/**
 * Sets the GoTrue password for an account that already signed in (OTP or
 * Bearer). `password_set_at` is stamped by the `auth_users_sync_password_set_at`
 * trigger when `encrypted_password` changes; the use case also writes the
 * column when that trigger left it null.
 */
export const setAuthUserPassword = async (
  authUserId: string,
  password: string
): Promise<void> => {
  const { error } = await admin().auth.admin.updateUserById(authUserId, {
    password,
  });

  if (!error) return;

  const status = (error as { status?: number }).status;
  if (status === 422 || error.code === 'weak_password') {
    throw CustomError.unprocessable('Password does not meet the requirements');
  }

  throw error;
};

export const setAuthUserBanned = async (
  authUserId: string,
  banned: boolean
): Promise<void> => {
  const { error } = await admin().auth.admin.updateUserById(authUserId, {
    ban_duration: banned ? '876000h' : 'none',
  });
  if (error) throw error;
};

export const resetAdminClientForTesting = (): void => {
  client = undefined;
};
