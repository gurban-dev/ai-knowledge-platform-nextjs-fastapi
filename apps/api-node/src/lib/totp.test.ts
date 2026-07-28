import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  buildOtpauthUri,
  generateRecoveryCodes,
  generateTotp,
  generateTotpSecret,
  verifyTotp,
} from './totp.js';

describe('base32', () => {
  it('round-trips arbitrary bytes', () => {
    const buf = Buffer.from('hello world', 'utf8');
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
  });

  it('matches a known RFC 4648 vector', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI======'.replace(/=/g, ''));
  });
});

describe('TOTP', () => {
  it('verifies a freshly generated code', () => {
    const secret = generateTotpSecret();
    const code = generateTotp(secret);
    expect(verifyTotp(secret, code)).toBe(true);
  });

  it('rejects an incorrect code', () => {
    const secret = generateTotpSecret();
    const wrong = generateTotp(secret) === '000000' ? '111111' : '000000';
    expect(verifyTotp(secret, wrong)).toBe(false);
  });

  it('accepts a code from the previous window (skew tolerance)', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const prev = generateTotp(secret, { now: now - 30_000 });
    expect(verifyTotp(secret, prev, { now, window: 1 })).toBe(true);
  });

  it('rejects a code outside the window', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const old = generateTotp(secret, { now: now - 120_000 });
    expect(verifyTotp(secret, old, { now, window: 1 })).toBe(false);
  });

  it('rejects non-numeric input', () => {
    expect(verifyTotp(generateTotpSecret(), 'abcdef')).toBe(false);
  });
});

describe('otpauth URI', () => {
  it('encodes issuer, account, and secret', () => {
    const uri = buildOtpauthUri({ secretBase32: 'ABCDEF', issuer: 'AKP', account: 'a@b.com' });
    expect(uri).toContain('otpauth://totp/AKP:a%40b.com');
    expect(uri).toContain('secret=ABCDEF');
    expect(uri).toContain('issuer=AKP');
  });
});

describe('recovery codes', () => {
  it('generates the requested count of unique codes', () => {
    const codes = generateRecoveryCodes(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[0-9a-f]{5}-[0-9a-f]{5}$/);
  });
});
