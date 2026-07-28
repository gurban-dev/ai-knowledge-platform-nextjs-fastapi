/**
 * Derive a URL-safe organization slug from a display name. Non-alphanumeric
 * runs collapse to a single hyphen; the result is lower-cased and trimmed.
 * Falls back to `org` when the name has no usable characters.
 */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'org';
}
