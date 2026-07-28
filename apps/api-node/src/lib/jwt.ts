import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { TokenExpiredError, TokenInvalidError } from './auth-errors.js';

/**
 * Stateless access-token signing/verification (HS256).
 *
 * Access tokens are short-lived and carry the minimal claims needed to make
 * authorization decisions without a database round-trip. Long-lived refresh
 * tokens are opaque and stored (hashed) server-side — they are NOT JWTs — so
 * they can be revoked, which stateless JWTs cannot.
 *
 * Also mints short-lived MFA-pending tokens used after password or Google
 * primary-factor success when the account has MFA enabled.
 */
export interface AccessTokenClaims {
  /** User id (subject). */
  sub: string;
  /** Active organization id for this token. */
  org: string;
  /** Effective role within the active organization. */
  role: string;
  /** Session id this access token was minted from (for correlation/revocation). */
  sid: string;
}

export interface MfaPendingClaims {
  /** User id awaiting second-factor verification. */
  sub: string;
  /** Discriminator so an access token can never be reused as an MFA pending. */
  purpose: 'mfa_pending';
}

export interface JwtConfig {
  secret: string;
  issuer: string;
  audience: string;
  accessTtlSeconds: number;
}

/** MFA pending tokens are deliberately short-lived (5 minutes). */
const MFA_PENDING_TTL_SECONDS = 300;

export class JwtService {
  private readonly key: Uint8Array;

  constructor(private readonly config: JwtConfig) {
    this.key = new TextEncoder().encode(config.secret);
  }

  async signAccessToken(claims: AccessTokenClaims): Promise<string> {
    return new SignJWT({ org: claims.org, role: claims.role, sid: claims.sid })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuer(this.config.issuer)
      .setAudience(this.config.audience)
      .setIssuedAt()
      .setExpirationTime(`${this.config.accessTtlSeconds}s`)
      .sign(this.key);
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: this.config.issuer,
        audience: this.config.audience,
      });
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.org !== 'string' ||
        typeof payload.role !== 'string' ||
        typeof payload.sid !== 'string'
      ) {
        throw new TokenInvalidError('Access token is missing required claims');
      }
      if (payload.purpose === 'mfa_pending') {
        throw new TokenInvalidError('MFA pending token is not an access token');
      }
      return { sub: payload.sub, org: payload.org, role: payload.role, sid: payload.sid };
    } catch (error) {
      if (error instanceof joseErrors.JWTExpired) {
        throw new TokenExpiredError();
      }
      if (error instanceof TokenInvalidError) throw error;
      throw new TokenInvalidError();
    }
  }

  /** Issue a short-lived token proving primary-factor success pending MFA. */
  async signMfaPendingToken(userId: string): Promise<string> {
    return new SignJWT({ purpose: 'mfa_pending' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(this.config.issuer)
      .setAudience(`${this.config.audience}:mfa`)
      .setIssuedAt()
      .setExpirationTime(`${MFA_PENDING_TTL_SECONDS}s`)
      .sign(this.key);
  }

  async verifyMfaPendingToken(token: string): Promise<MfaPendingClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: this.config.issuer,
        audience: `${this.config.audience}:mfa`,
      });
      if (typeof payload.sub !== 'string' || payload.purpose !== 'mfa_pending') {
        throw new TokenInvalidError('MFA pending token is invalid');
      }
      return { sub: payload.sub, purpose: 'mfa_pending' };
    } catch (error) {
      if (error instanceof joseErrors.JWTExpired) {
        throw new TokenExpiredError('MFA challenge has expired; sign in again');
      }
      if (error instanceof TokenInvalidError) throw error;
      throw new TokenInvalidError('MFA pending token is invalid');
    }
  }
}
