import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Production OAuth helpers: PKCE (S256) + HMAC-signed state that binds the
 * redirect URI and code verifier so the authorization code cannot be replayed
 * against a different callback or without the verifier.
 */

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes — matches the cookie maxAge.

export interface OAuthStatePayload {
  /** High-entropy CSRF nonce (also used as the Google `state` query value). */
  nonce: string;
  /** Exact redirect URI registered for this flow. */
  redirectUri: string;
  /** PKCE code_verifier (high-entropy); never logged. */
  codeVerifier: string;
  /** Expiry as unix ms. */
  exp: number;
}

/** Constant-time equality for arbitrary strings (UTF-8). */
export function safeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** RFC 7636 S256 code_challenge from a code_verifier. */
export function pkceChallengeS256(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

/** Mint a fresh PKCE verifier (43–128 chars of unreserved URL-safe alphabet). */
export function generatePkceVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Sign an OAuth state payload as `base64url(payload).base64url(hmac)`.
 * The HMAC key should be the JWT access secret (or a dedicated OAuth secret).
 */
export function signOAuthState(payload: OAuthStatePayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** Verify and parse a signed OAuth state. Returns null on any failure. */
export function verifyOAuthState(state: string, secret: string): OAuthStatePayload | null {
  const dot = state.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  if (!safeEqualString(sig, expected)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthStatePayload;
    if (
      typeof parsed.nonce !== 'string' ||
      typeof parsed.redirectUri !== 'string' ||
      typeof parsed.codeVerifier !== 'string' ||
      typeof parsed.exp !== 'number'
    ) {
      return null;
    }
    if (parsed.exp <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Build a fresh signed state for a Google authorization start. */
export function createOAuthState(
  redirectUri: string,
  secret: string,
): { state: string; codeChallenge: string; nonce: string } {
  const codeVerifier = generatePkceVerifier();
  const nonce = randomBytes(24).toString('base64url');
  const payload: OAuthStatePayload = {
    nonce,
    redirectUri,
    codeVerifier,
    exp: Date.now() + STATE_TTL_MS,
  };
  return {
    state: signOAuthState(payload, secret),
    codeChallenge: pkceChallengeS256(codeVerifier),
    nonce,
  };
}
