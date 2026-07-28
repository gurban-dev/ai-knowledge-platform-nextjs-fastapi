/**
 * Minimal, dependency-free IP allowlisting for API keys.
 * Supports exact IPv4/IPv6 string matches and IPv4 CIDR ranges (e.g. 10.0.0.0/8).
 * An empty allowlist means "any source is permitted".
 */

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << 8) | octet;
  }
  // Coerce to unsigned 32-bit.
  return value >>> 0;
}

function matchesCidr(ip: string, cidr: string): boolean {
  const [range, bitsRaw] = cidr.split('/');
  if (!range || bitsRaw === undefined) return false;
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);
  if (ipInt === null || rangeInt === null) return false;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

/** True if `ip` is permitted by the allowlist (empty allowlist ⇒ allow all). */
export function ipMatchesAllowlist(ip: string, allowlist: readonly string[]): boolean {
  if (allowlist.length === 0) return true;
  for (const entry of allowlist) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (trimmed.includes('/')) {
      if (matchesCidr(ip, trimmed)) return true;
    } else if (trimmed === ip) {
      return true;
    }
  }
  return false;
}
