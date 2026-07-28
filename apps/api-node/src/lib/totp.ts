import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * RFC 4648 base32 + RFC 6238 TOTP, implemented with Node crypto only (no third
 * party dependency). Used for authenticator-app based MFA. Secrets are shared
 * with the authenticator via an `otpauth://` URI and verified with a small time
 * window to tolerate clock skew.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DEFAULT_DIGITS = 6;
const DEFAULT_PERIOD = 30; // seconds

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Generate a new base32-encoded TOTP secret (default 20 bytes / 160 bits). */
export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

function hotp(secret: Buffer, counter: number, digits: number): string {
  const buf = Buffer.alloc(8);
  // Write the 64-bit counter big-endian (high 32 bits are effectively 0).
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter % 0x100000000, 4);
  const digest = createHmac('sha1', secret).update(buf).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

export interface TotpOptions {
  digits?: number;
  period?: number;
  /** Number of periods before/after `now` to accept (clock-skew tolerance). */
  window?: number;
  now?: number;
}

/** Generate the current TOTP code for a base32 secret (mainly for tests). */
export function generateTotp(secretBase32: string, options: TotpOptions = {}): string {
  const { digits = DEFAULT_DIGITS, period = DEFAULT_PERIOD, now = Date.now() } = options;
  const counter = Math.floor(now / 1000 / period);
  return hotp(base32Decode(secretBase32), counter, digits);
}

/** Constant-time verify a submitted TOTP code within the allowed window. */
export function verifyTotp(
  secretBase32: string,
  token: string,
  options: TotpOptions = {},
): boolean {
  const {
    digits = DEFAULT_DIGITS,
    period = DEFAULT_PERIOD,
    window = 1,
    now = Date.now(),
  } = options;
  const normalized = token.replace(/\s/g, '');
  if (!/^\d+$/.test(normalized)) return false;
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(now / 1000 / period);
  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = hotp(secret, counter + offset, digits);
    const a = Buffer.from(candidate);
    const b = Buffer.from(normalized.padStart(candidate.length, '0'));
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

/** Build an `otpauth://totp/...` URI for QR provisioning. */
export function buildOtpauthUri(params: {
  secretBase32: string;
  issuer: string;
  account: string;
  digits?: number;
  period?: number;
}): string {
  // Preserve the `issuer:account` separator; encode each component individually.
  const label = `${encodeURIComponent(params.issuer)}:${encodeURIComponent(params.account)}`;
  const query = new URLSearchParams({
    secret: params.secretBase32,
    issuer: params.issuer,
    algorithm: 'SHA1',
    digits: String(params.digits ?? DEFAULT_DIGITS),
    period: String(params.period ?? DEFAULT_PERIOD),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

/** Generate N single-use recovery codes (plaintext, shown once). */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(5).toString('hex'); // 10 hex chars
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}
