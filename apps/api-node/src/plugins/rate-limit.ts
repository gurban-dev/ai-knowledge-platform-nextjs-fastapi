import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';

/**
 * Global rate limiting backed by Redis so limits hold across horizontally
 * scaled instances. Authenticated requests are keyed by user id; anonymous
 * requests fall back to client IP. Per-route stricter limits (e.g. login) are
 * layered on top via route-level `config.rateLimit`.
 */
const rateLimitPlugin: FastifyPluginAsync = async (fastify) => {
  const { rateLimit: cfg } = fastify.container.config;

  await fastify.register(rateLimit, {
    max: cfg.max,
    timeWindow: cfg.windowMs,
    redis: fastify.container.redis,
    // Distinguish app instances' key namespace from other Redis users.
    nameSpace: 'akp-rl:',
    keyGenerator: (request) => request.auth?.userId ?? request.ip,
    // Return our standard error envelope shape via the central error handler.
    addHeadersOnExceeding: { 'x-ratelimit-limit': true, 'x-ratelimit-remaining': true },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
  });
};

export default fp(rateLimitPlugin, { name: 'rate-limit', dependencies: ['container', 'auth'] });
