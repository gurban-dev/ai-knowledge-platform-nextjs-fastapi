import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { UnauthorizedError } from '@akp/core';

/**
 * A verified Google identity, distilled from a validated OpenID Connect
 * `id_token`. Only the claims we trust and use are surfaced.
 */
export interface GoogleIdentity {
  /** Stable, unique Google account subject identifier. */
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  avatarUrl?: string | undefined;
}

/**
 * Abstraction over Google's OAuth2/OIDC endpoints. Kept as an interface so the
 * authentication routes depend on a seam that tests can substitute with a
 * deterministic fake (no network, no real Google credentials).
 */
export interface GoogleOAuthProvider {
  /** True when a client id + secret are configured. */
  readonly enabled: boolean;
  /** Build the consent-screen URL to redirect the user's browser to. */
  buildAuthorizationUrl(input: {
    redirectUri: string;
    state: string;
    /** RFC 7636 S256 code_challenge (required for production PKCE). */
    codeChallenge: string;
  }): string;
  /** Exchange an authorization code (+ PKCE verifier) for a verified identity. */
  exchangeCode(input: {
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<GoogleIdentity>;
  /**
   * Verify a Google Identity Services `credential` (OIDC id_token) from the
   * in-page Sign in with Google button / One Tap callback.
   */
  verifyIdToken(idToken: string): Promise<GoogleIdentity>;
}

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs';
// Google mints tokens under both forms of the issuer; accept either.
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

interface GoogleTokenResponse {
  id_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleIdTokenClaims {
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  given_name?: string;
  picture?: string;
}

export interface GoogleOAuthClientOptions {
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  /** Injectable fetch, primarily for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable JWKS resolver, primarily for tests. */
  jwks?: JWTVerifyGetKey;
}

/**
 * Production Google OAuth client (Authorization Code + PKCE + confidential client).
 *
 * Flow:
 *   1. {@link buildAuthorizationUrl} sends the browser to Google with PKCE S256.
 *   2. Google redirects back with a `code`; {@link exchangeCode} trades it
 *      (client secret + code_verifier, server-side only) for an `id_token`.
 *   3. The `id_token` is verified against Google's JWKS (issuer + audience).
 */
export class GoogleOAuthClient implements GoogleOAuthProvider {
  private readonly clientId?: string | undefined;
  private readonly clientSecret?: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly jwks: JWTVerifyGetKey;

  constructor(options: GoogleOAuthClientOptions) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.jwks = options.jwks ?? createRemoteJWKSet(new URL(GOOGLE_JWKS_URI));
  }

  get enabled(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  buildAuthorizationUrl(input: {
    redirectUri: string;
    state: string;
    codeChallenge: string;
  }): string {
    this.assertConfigured();
    const url = new URL(GOOGLE_AUTH_ENDPOINT);
    url.searchParams.set('client_id', this.clientId!);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', input.state);
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    // Let returning users pick an account and avoid a stale silent grant.
    url.searchParams.set('prompt', 'select_account');
    url.searchParams.set('access_type', 'online');
    return url.toString();
  }

  async exchangeCode(input: {
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<GoogleIdentity> {
    this.assertConfigured();

    const body = new URLSearchParams({
      code: input.code,
      client_id: this.clientId!,
      client_secret: this.clientSecret!,
      redirect_uri: input.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: input.codeVerifier,
    });

    const res = await this.fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    const token = (await res.json().catch(() => ({}))) as GoogleTokenResponse;
    if (!res.ok || !token.id_token) {
      throw new UnauthorizedError(
        `Google token exchange failed${token.error ? `: ${token.error}` : ''}`,
      );
    }

    return this.verifyIdToken(token.id_token);
  }

  async verifyIdToken(idToken: string): Promise<GoogleIdentity> {
    this.assertConfigured();

    let claims: GoogleIdTokenClaims & { sub?: string };
    try {
      const verified = await jwtVerify(idToken, this.jwks, {
        issuer: GOOGLE_ISSUERS,
        audience: this.clientId!,
      });
      claims = verified.payload;
    } catch {
      throw new UnauthorizedError('Google id_token verification failed');
    }

    if (!claims.sub || !claims.email) {
      throw new UnauthorizedError('Google id_token is missing required claims');
    }

    const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
    const name =
      [claims.name, claims.given_name]
        .map((value) => value?.trim())
        .find((value): value is string => Boolean(value)) ?? claims.email.split('@')[0]!;

    return {
      sub: claims.sub,
      email: claims.email,
      emailVerified,
      name,
      ...(claims.picture ? { avatarUrl: claims.picture } : {}),
    };
  }

  private assertConfigured(): void {
    if (!this.enabled) {
      throw new UnauthorizedError('Google OAuth is not configured');
    }
  }
}
