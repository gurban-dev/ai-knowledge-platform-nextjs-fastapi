import { describe, expect, it } from 'vitest';
import { slugify } from './slug.js';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Acme Corporation')).toBe('acme-corporation');
    expect(slugify('  Wise  Payments  ')).toBe('wise-payments');
  });

  it('strips punctuation and collapses separators', () => {
    expect(slugify('Foo & Bar, Inc.')).toBe('foo-bar-inc');
    expect(slugify('a---b')).toBe('a-b');
  });

  it('falls back to "org" for empty results', () => {
    expect(slugify('!!!')).toBe('org');
    expect(slugify('')).toBe('org');
  });

  it('truncates very long names', () => {
    expect(slugify('x'.repeat(100)).length).toBeLessThanOrEqual(48);
  });
});
