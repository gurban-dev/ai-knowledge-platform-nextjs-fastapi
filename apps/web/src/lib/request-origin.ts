/**
 * Resolve the browser-facing origin for OAuth redirects and postMessage.
 *
 * Behind Cloudflare/ngrok tunnels, Next receives the request as localhost, so
 * `new URL(request.url).origin` is wrong. Prefer standard forwarded headers.
 */
export function getPublicOrigin(request: Request): string {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || request.headers.get('host') || url.host;
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const proto = forwardedProto || url.protocol.replace(':', '') || 'http';
  return `${proto}://${host}`;
}
