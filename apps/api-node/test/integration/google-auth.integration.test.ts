import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { GoogleIdentity, GoogleOAuthProvider } from '../../src/lib/google-oauth.js';
import { createHarness, INTEGRATION_ENABLED, type TestHarness } from './harness.js';

/**
 * End-to-end "Sign in with Google" against real Postgres + Redis, using a
 * deterministic fake identity provider (no network, no Google credentials).
 * Exercises PKCE + signed state, first-contact sign-up, returning sign-in,
 * account linking, and the feature gate.
 */

const REDIRECT_URI = 'http://localhost:3000/api/auth/google/callback';

/** A controllable stand-in for Google's OAuth endpoints. */
class FakeGoogleProvider implements GoogleOAuthProvider {
  readonly enabled = true;
  identity: GoogleIdentity = {
    sub: 'google-sub-abc',
    email: 'ada@example.com',
    emailVerified: true,
    name: 'Ada Lovelace',
    avatarUrl: 'https://pic/ada.png',
  };
  lastCodeVerifier: string | undefined;

  buildAuthorizationUrl(input: {
    redirectUri: string;
    state: string;
    codeChallenge: string;
  }): string {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('state', input.state);
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  async exchangeCode(input: {
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<GoogleIdentity> {
    this.lastCodeVerifier = input.codeVerifier;
    return this.identity;
  }

  async verifyIdToken(_idToken: string): Promise<GoogleIdentity> {
    return this.identity;
  }
}

describe.skipIf(!INTEGRATION_ENABLED)('Google sign-in (integration)', () => {
  let harness: TestHarness;
  const google = new FakeGoogleProvider();

  beforeAll(async () => {
    harness = await createHarness({ googleOAuth: google });
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    google.identity = {
      sub: 'google-sub-abc',
      email: 'ada@example.com',
      emailVerified: true,
      name: 'Ada Lovelace',
      avatarUrl: 'https://pic/ada.png',
    };
    google.lastCodeVerifier = undefined;
  });

  async function startGoogle(): Promise<string> {
    const res = await harness.app.inject({
      method: 'GET',
      url: `/v1/auth/google/start?redirectUri=${encodeURIComponent(REDIRECT_URI)}`,
    });
    expect(res.statusCode).toBe(200);
    return res.json().state as string;
  }

  async function exchange(code: string, state: string) {
    return harness.app.inject({
      method: 'POST',
      url: '/v1/auth/google/exchange',
      payload: { code, redirectUri: REDIRECT_URI, state },
    });
  }

  it('returns an authorization URL with PKCE + a signed state', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: `/v1/auth/google/start?redirectUri=${encodeURIComponent(REDIRECT_URI)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.authorizationUrl).toContain('accounts.google.com');
    expect(body.authorizationUrl).toContain('code_challenge=');
    expect(body.authorizationUrl).toContain('code_challenge_method=S256');
    expect(typeof body.state).toBe('string');
    expect(body.state.length).toBeGreaterThan(10);
  });

  it('rejects a redirect URI that is not the exact web callback', async () => {
    const evil = await harness.app.inject({
      method: 'GET',
      url: `/v1/auth/google/start?redirectUri=${encodeURIComponent('https://evil.example.com/steal')}`,
    });
    expect(evil.statusCode).toBe(422);

    // Same origin but wrong path must also fail (exact allowlist).
    const wrongPath = await harness.app.inject({
      method: 'GET',
      url: `/v1/auth/google/start?redirectUri=${encodeURIComponent('http://localhost:3000/api/auth/google/other')}`,
    });
    expect(wrongPath.statusCode).toBe(422);
  });

  it('allows Google callbacks for every configured CORS web origin', async () => {
    // Default harness CORS includes localhost:3000 via env defaults; WEB_PUBLIC_URL matches.
    const res = await harness.app.inject({
      method: 'GET',
      url: `/v1/auth/google/start?redirectUri=${encodeURIComponent(REDIRECT_URI)}`,
    });
    expect(res.statusCode).toBe(200);
  });

  it('provisions a new org + owner on first Google sign-up, then signs the same user back in', async () => {
    const state1 = await startGoogle();
    const first = await exchange('auth-code-1', state1);
    expect(first.statusCode).toBe(200);
    expect(google.lastCodeVerifier).toBeTruthy();
    const firstBody = first.json();
    expect(firstBody.user.email).toBe('ada@example.com');
    expect(firstBody.user.avatarUrl).toBe('https://pic/ada.png');
    expect(firstBody.role).toBe('OWNER');
    expect(firstBody.tokens.accessToken).toBeTruthy();
    const orgId = firstBody.organization.id as string;
    const userId = firstBody.user.id as string;

    const stored = await harness.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(stored.googleSub).toBe('google-sub-abc');
    expect(stored.passwordHash).toBeNull();

    const state2 = await startGoogle();
    const second = await exchange('auth-code-2', state2);
    expect(second.statusCode).toBe(200);
    const secondBody = second.json();
    expect(secondBody.user.id).toBe(userId);
    expect(secondBody.organization.id).toBe(orgId);

    expect(await harness.prisma.user.count()).toBe(1);
    expect(await harness.prisma.organization.count()).toBe(1);
  });

  it('links Google to an existing email-registered account instead of duplicating it', async () => {
    const register = await harness.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        email: 'ada@example.com',
        password: 'KnowledgePass1',
        name: 'Ada',
        organizationName: 'Ada Co',
      },
    });
    expect(register.statusCode).toBe(201);
    const userId = register.json().user.id as string;

    const state = await startGoogle();
    const viaGoogle = await exchange('auth-code-1', state);
    expect(viaGoogle.statusCode).toBe(200);
    expect(viaGoogle.json().user.id).toBe(userId);

    const stored = await harness.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(stored.googleSub).toBe('google-sub-abc');
    expect(await harness.prisma.user.count()).toBe(1);
  });

  it('refuses an unverified Google email', async () => {
    google.identity = { ...google.identity, emailVerified: false };
    const state = await startGoogle();
    const res = await exchange('auth-code-1', state);
    expect(res.statusCode).toBe(401);
    expect(await harness.prisma.user.count()).toBe(0);
  });

  it('rejects a forged or missing OAuth state on exchange', async () => {
    const res = await exchange('auth-code-1', 'not-a-valid-signed-state');
    expect(res.statusCode).toBe(401);
  });

  it('signs up via a GIS id_token credential', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/v1/auth/google/credential',
      payload: { idToken: 'gis-credential-token' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe('ada@example.com');
    expect(res.json().tokens.accessToken).toBeTruthy();

    const stored = await harness.prisma.user.findUnique({ where: { email: 'ada@example.com' } });
    expect(stored?.googleSub).toBe('google-sub-abc');
  });
});

describe.skipIf(!INTEGRATION_ENABLED)('Google sign-in disabled (integration)', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('reports the feature as disabled on both endpoints', async () => {
    const start = await harness.app.inject({
      method: 'GET',
      url: `/v1/auth/google/start?redirectUri=${encodeURIComponent(REDIRECT_URI)}`,
    });
    expect(start.statusCode).toBe(403);

    const exchange = await harness.app.inject({
      method: 'POST',
      url: '/v1/auth/google/exchange',
      payload: { code: 'x', redirectUri: REDIRECT_URI, state: 'x' },
    });
    expect(exchange.statusCode).toBe(403);

    const credential = await harness.app.inject({
      method: 'POST',
      url: '/v1/auth/google/credential',
      payload: { idToken: 'x' },
    });
    expect(credential.statusCode).toBe(403);

    const config = await harness.app.inject({
      method: 'GET',
      url: '/v1/auth/google/config',
    });
    expect(config.statusCode).toBe(200);
    expect(config.json()).toEqual({ enabled: false, clientId: null });
  });
});
