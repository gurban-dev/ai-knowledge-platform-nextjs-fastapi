import { describe, expect, it, vi } from 'vitest';
import { SignJWT, generateKeyPair, type KeyLike } from 'jose';
import { UnauthorizedError } from '@akp/core';
import { GoogleOAuthClient } from './google-oauth.js';
import { createOAuthState, pkceChallengeS256, verifyOAuthState } from './oauth-state.js';

const CLIENT_ID = 'client-id.apps.googleusercontent.com';
const CLIENT_SECRET = 'client-secret';
const STATE_SECRET = 'test-oauth-state-secret-min-32-chars!!';

function tokenFetch(idToken: string, ok = true): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok,
    json: async () => (ok ? { id_token: idToken } : { error: 'invalid_grant' }),
  }) as typeof fetch;
}

async function signIdToken(
  privateKey: KeyLike,
  claims: Record<string, unknown>,
  overrides: { issuer?: string; audience?: string } = {},
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(overrides.issuer ?? 'https://accounts.google.com')
    .setAudience(overrides.audience ?? CLIENT_ID)
    .setSubject((claims.sub as string) ?? 'sub-1')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}

describe('OAuth state + PKCE', () => {
  it('round-trips a signed state and derives an S256 challenge', () => {
    const { state, codeChallenge, nonce } = createOAuthState(
      'http://localhost:3000/api/auth/google/callback',
      STATE_SECRET,
    );
    const payload = verifyOAuthState(state, STATE_SECRET);
    expect(payload).not.toBeNull();
    expect(payload!.nonce).toBe(nonce);
    expect(payload!.redirectUri).toBe('http://localhost:3000/api/auth/google/callback');
    expect(pkceChallengeS256(payload!.codeVerifier)).toBe(codeChallenge);
  });

  it('rejects a tampered state', () => {
    const { state } = createOAuthState(
      'http://localhost:3000/api/auth/google/callback',
      STATE_SECRET,
    );
    expect(verifyOAuthState(`${state}x`, STATE_SECRET)).toBeNull();
    expect(verifyOAuthState(state, 'wrong-secret')).toBeNull();
  });
});

describe('GoogleOAuthClient (configuration)', () => {
  it('reports disabled and refuses to build a URL without credentials', () => {
    const client = new GoogleOAuthClient({});
    expect(client.enabled).toBe(false);
    expect(() =>
      client.buildAuthorizationUrl({
        redirectUri: 'https://app/cb',
        state: 's',
        codeChallenge: 'challenge',
      }),
    ).toThrow(UnauthorizedError);
  });

  it('builds a Google consent URL with PKCE parameters', () => {
    const client = new GoogleOAuthClient({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    expect(client.enabled).toBe(true);

    const url = new URL(
      client.buildAuthorizationUrl({
        redirectUri: 'https://app.example.com/api/auth/google/callback',
        state: 'state-xyz',
        codeChallenge: 'challenge-abc',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('code_challenge')).toBe('challenge-abc');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
  });
});

describe('GoogleOAuthClient.exchangeCode', () => {
  it('verifies the id_token and returns the distilled identity', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const idToken = await signIdToken(privateKey, {
      sub: 'google-123',
      email: 'ada@example.com',
      email_verified: true,
      name: 'Ada Lovelace',
      picture: 'https://pic/ada.png',
    });

    const fetchImpl = tokenFetch(idToken);
    const client = new GoogleOAuthClient({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      fetchImpl,
      jwks: async () => publicKey,
    });

    const identity = await client.exchangeCode({
      code: 'auth-code',
      redirectUri: 'https://app/cb',
      codeVerifier: 'verifier',
    });
    expect(identity).toEqual({
      sub: 'google-123',
      email: 'ada@example.com',
      emailVerified: true,
      name: 'Ada Lovelace',
      avatarUrl: 'https://pic/ada.png',
    });

    // PKCE verifier is included in the token request body.
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = (init as RequestInit).body;
    expect(typeof body === 'string' ? body : '').toContain('code_verifier=verifier');
  });

  it('rejects an id_token minted for a different audience', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const idToken = await signIdToken(
      privateKey,
      { sub: 'google-123', email: 'ada@example.com', email_verified: true },
      { audience: 'someone-elses-client' },
    );

    const client = new GoogleOAuthClient({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      fetchImpl: tokenFetch(idToken),
      jwks: async () => publicKey,
    });

    await expect(
      client.exchangeCode({
        code: 'auth-code',
        redirectUri: 'https://app/cb',
        codeVerifier: 'verifier',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('surfaces a failed token exchange as an authorization error', async () => {
    const client = new GoogleOAuthClient({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      fetchImpl: tokenFetch('unused', false),
    });
    await expect(
      client.exchangeCode({
        code: 'bad-code',
        redirectUri: 'https://app/cb',
        codeVerifier: 'verifier',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
