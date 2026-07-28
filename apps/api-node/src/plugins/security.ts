import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';

/**
 * Baseline HTTP hardening: security headers via Helmet and a strict CORS allow
 * list sourced from configuration. The allow list is exact-match; a request
 * from an unlisted origin receives no CORS headers (browser blocks it).
 */
const securityPlugin: FastifyPluginAsync = async (fastify) => {
  const { corsOrigins } = fastify.container.config.server;
  const allowed = new Set(corsOrigins);

  await fastify.register(helmet, {
    // Disabled because the bundled Swagger UI at /docs needs inline styles/scripts;
    // the API itself returns JSON, so a CSP adds little. The dedicated web app
    // (Next.js) enforces its own CSP.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  await fastify.register(cors, {
    origin: (origin, cb) => {
      // Non-browser clients (no Origin header) are allowed; browsers are checked.
      if (!origin || allowed.has(origin)) {
        cb(null, true);
        return;
      }
      cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    maxAge: 86_400,
  });
};

export default fp(securityPlugin, { name: 'security', dependencies: ['container'] });
