import { CustomError } from '../../domain/errors/CustomError';
import {
  refreshSession,
  signInWithPassword,
  verifyEmailOtp,
} from '../supabaseSession.service';

const tokenBody = {
  access_token: 'access',
  refresh_token: 'refresh',
  expires_in: 3600,
  user: { id: 'user-id' },
};

describe('supabaseSession.service', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('exchanges a password for a GoTrue session', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => tokenBody,
    });

    const session = await signInWithPassword('admin@pragma.test', 'secret');

    expect(session).toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresIn: 3600,
      authUserId: 'user-id',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/auth/v1/token?grant_type=password');
    expect(init.headers).toEqual(
      expect.objectContaining({ apikey: 'fake-service-role-key' })
    );
    expect(JSON.parse(String(init.body))).toEqual({
      email: 'admin@pragma.test',
      password: 'secret',
    });
  });

  it('maps a rejected password to 401 without leaking the GoTrue body', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ msg: 'Invalid login credentials' }),
    });

    await expect(signInWithPassword('a@b.c', 'nope')).rejects.toEqual(
      CustomError.unauthorized('Invalid email or password')
    );
  });

  it('verifies an email OTP', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => tokenBody,
    });

    await verifyEmailOtp('admin@pragma.test', '123456');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/auth/v1/verify');
    expect(JSON.parse(String(init.body))).toEqual({
      email: 'admin@pragma.test',
      token: '123456',
      type: 'email',
    });
  });

  it('refreshes with the refresh token grant', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => tokenBody,
    });

    await refreshSession('old-refresh');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('grant_type=refresh_token');
    expect(JSON.parse(String(init.body))).toEqual({
      refresh_token: 'old-refresh',
    });
  });
});
