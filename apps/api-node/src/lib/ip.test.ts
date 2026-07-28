import { describe, expect, it } from 'vitest';
import { ipMatchesAllowlist } from './ip.js';

describe('ipMatchesAllowlist', () => {
  it('allows any source when the allowlist is empty', () => {
    expect(ipMatchesAllowlist('203.0.113.5', [])).toBe(true);
  });

  it('matches exact IPs', () => {
    expect(ipMatchesAllowlist('203.0.113.5', ['203.0.113.5'])).toBe(true);
    expect(ipMatchesAllowlist('203.0.113.6', ['203.0.113.5'])).toBe(false);
  });

  it('matches IPv4 CIDR ranges', () => {
    expect(ipMatchesAllowlist('10.1.2.3', ['10.0.0.0/8'])).toBe(true);
    expect(ipMatchesAllowlist('11.1.2.3', ['10.0.0.0/8'])).toBe(false);
    expect(ipMatchesAllowlist('192.168.1.20', ['192.168.1.0/24'])).toBe(true);
    expect(ipMatchesAllowlist('192.168.2.20', ['192.168.1.0/24'])).toBe(false);
  });

  it('supports a /0 range as allow-all', () => {
    expect(ipMatchesAllowlist('8.8.8.8', ['0.0.0.0/0'])).toBe(true);
  });

  it('rejects malformed entries safely', () => {
    expect(ipMatchesAllowlist('8.8.8.8', ['not-an-ip'])).toBe(false);
    expect(ipMatchesAllowlist('8.8.8.8', ['10.0.0.0/40'])).toBe(false);
  });
});
