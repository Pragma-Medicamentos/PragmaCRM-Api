import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from 'jose';
import {
  setKeySetForTesting,
  verifyAccessToken,
} from '../supabaseJwt';

// No mocks here: real ES256 keys, real signatures, no network. This is the one
// place where the cryptography and the claim checks are actually exercised.
const ISSUER = 'http://127.0.0.1:54321/auth/v1';
const SUB = '99999999-9999-9999-9999-999999999999';

let sign: (claims: Record<string, unknown>, overrides?: {
  issuer?: string;
  audience?: string;
  expiresIn?: string;
}) => Promise<string>;

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-key';
  jwk.alg = 'ES256';
  setKeySetForTesting(createLocalJWKSet({ keys: [jwk] }));

  sign = (claims, overrides = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
      .setIssuer(overrides.issuer ?? ISSUER)
      .setAudience(overrides.audience ?? 'authenticated')
      .setIssuedAt()
      .setExpirationTime(overrides.expiresIn ?? '1h')
      .sign(privateKey);
});

afterAll(() => setKeySetForTesting(undefined));

describe('verifyAccessToken', () => {
  it('acepta un token bien firmado y devuelve el sub', async () => {
    const token = await sign({ sub: SUB, email: 'admin@pragma.test' });

    await expect(verifyAccessToken(token)).resolves.toEqual({
      sub: SUB,
      email: 'admin@pragma.test',
    });
  });

  it('rechaza un token de otro proyecto de Supabase', async () => {
    const token = await sign({ sub: SUB }, { issuer: 'https://otro.supabase.co/auth/v1' });

    await expect(verifyAccessToken(token)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('rechaza un audience distinto de authenticated', async () => {
    const token = await sign({ sub: SUB }, { audience: 'anon' });

    await expect(verifyAccessToken(token)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('rechaza un token expirado', async () => {
    const token = await sign({ sub: SUB }, { expiresIn: '-1h' });

    await expect(verifyAccessToken(token)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('rechaza una sesión anónima', async () => {
    const token = await sign({ sub: SUB, is_anonymous: true });

    await expect(verifyAccessToken(token)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('rechaza una firma alterada', async () => {
    const token = await sign({ sub: SUB });
    const tampered = `${token.slice(0, -4)}AAAA`;

    await expect(verifyAccessToken(tampered)).rejects.toMatchObject({
      statusCode: 401,
    });
  });
});
