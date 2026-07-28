import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';

/**
 * Cryptographic helpers for the auth subsystem.
 *
 * - Passwords: Argon2id (memory-hard, resistant to GPU cracking).
 * - Opaque tokens (refresh tokens, API keys, invites): high-entropy random
 *   strings hashed with SHA-256 before storage. We only ever persist the hash,
 *   so a database leak does not expose usable credentials.
 */

const ARGON2_TYPE = argon2.argon2id;

export async function hashPassword(password: string, memoryCost: number): Promise<string> {
  return argon2.hash(password, {
    type: ARGON2_TYPE,
    memoryCost,
    timeCost: 3,
    parallelism: 1,
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // A malformed hash should never authenticate a user.
    return false;
  }
}

/** Generate a URL-safe, high-entropy opaque token (default 256 bits). */
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Deterministically hash an opaque token for storage/lookup. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison of two hex-encoded hashes. */
export function safeCompareHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
