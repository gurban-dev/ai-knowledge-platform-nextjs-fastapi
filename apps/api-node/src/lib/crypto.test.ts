import { describe, expect, it } from 'vitest';
import {
  generateOpaqueToken,
  hashPassword,
  hashToken,
  safeCompareHex,
  verifyPassword,
} from './crypto.js';

// Argon2 params kept minimal for test speed; production uses config value.
const MEMORY_COST = 8192;

describe('password hashing', () => {
  it('verifies a correct password and rejects an incorrect one', async () => {
    const hash = await hashPassword('Sup3rSecret!', MEMORY_COST);
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, 'Sup3rSecret!')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });

  it('returns false for a malformed hash instead of throwing', async () => {
    expect(await verifyPassword('not-a-hash', 'whatever')).toBe(false);
  });
});

describe('opaque tokens', () => {
  it('generates unique, url-safe tokens', () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('hashes tokens deterministically', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('safeCompareHex', () => {
  it('compares equal and unequal hex strings', () => {
    const h = hashToken('x');
    expect(safeCompareHex(h, h)).toBe(true);
    expect(safeCompareHex(h, hashToken('y'))).toBe(false);
    expect(safeCompareHex('aa', 'aabb')).toBe(false);
  });
});
