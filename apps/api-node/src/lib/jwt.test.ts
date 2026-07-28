import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { JwtService } from './jwt.js';
import { TokenExpiredError, TokenInvalidError } from './auth-errors.js';

const cfg = {
  secret: 'test-secret-that-is-at-least-32-characters-long',
  issuer: 'akp',
  audience: 'akp-api',
  accessTtlSeconds: 900,
};

const claims = { sub: 'usr_1', org: 'org_1', role: 'OWNER', sid: 'ses_1' };

describe('JwtService', () => {
  const service = new JwtService(cfg);

  it('signs and verifies an access token round-trip', async () => {
    const token = await service.signAccessToken(claims);
    const verified = await service.verifyAccessToken(token);
    expect(verified).toEqual(claims);
  });

  it('rejects a tampered token', async () => {
    const token = await service.signAccessToken(claims);
    const tampered = `${token}x`;
    await expect(service.verifyAccessToken(tampered)).rejects.toBeInstanceOf(TokenInvalidError);
  });

  it('rejects a token signed with a different secret', async () => {
    const other = new JwtService({ ...cfg, secret: 'a-completely-different-secret-32-chars-yes' });
    const token = await other.signAccessToken(claims);
    await expect(service.verifyAccessToken(token)).rejects.toBeInstanceOf(TokenInvalidError);
  });

  it('rejects a token with the wrong audience', async () => {
    const key = new TextEncoder().encode(cfg.secret);
    const token = await new SignJWT({ org: 'org_1', role: 'OWNER', sid: 'ses_1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('usr_1')
      .setIssuer(cfg.issuer)
      .setAudience('someone-else')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(key);
    await expect(service.verifyAccessToken(token)).rejects.toBeInstanceOf(TokenInvalidError);
  });

  it('raises TokenExpiredError for an expired token', async () => {
    const key = new TextEncoder().encode(cfg.secret);
    const past = Math.floor(Date.now() / 1000) - 60;
    const token = await new SignJWT({ org: 'org_1', role: 'OWNER', sid: 'ses_1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('usr_1')
      .setIssuer(cfg.issuer)
      .setAudience(cfg.audience)
      .setIssuedAt(past - 60)
      .setExpirationTime(past)
      .sign(key);
    await expect(service.verifyAccessToken(token)).rejects.toBeInstanceOf(TokenExpiredError);
  });

  it('rejects a token missing required claims', async () => {
    const key = new TextEncoder().encode(cfg.secret);
    const token = await new SignJWT({ org: 'org_1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('usr_1')
      .setIssuer(cfg.issuer)
      .setAudience(cfg.audience)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(key);
    await expect(service.verifyAccessToken(token)).rejects.toBeInstanceOf(TokenInvalidError);
  });
});
