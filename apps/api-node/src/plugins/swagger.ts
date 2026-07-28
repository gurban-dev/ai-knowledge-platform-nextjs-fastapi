import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

/**
 * OpenAPI 3 generation driven by the same Zod schemas used for validation, so
 * the documentation can never drift from the implementation. Served interactively
 * at `/docs`; the raw spec is available at `/docs/json`.
 */
const swaggerPlugin: FastifyPluginAsync = async (fastify) => {
  const { config } = fastify.container;

  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'AI Knowledge Platform API',
        description:
          'Securely connect internal knowledge to AI with observability into retrieval quality, accuracy, cost, and operational health.',
        version: '0.1.0',
      },
      servers: [{ url: config.server.publicUrl }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Short-lived access token obtained from /v1/auth/login.',
          },
          apiKey: {
            type: 'apiKey',
            in: 'header',
            name: 'x-api-key',
            description: 'Organization-scoped API key for programmatic and MCP access.',
          },
        },
      },
      tags: [
        { name: 'health', description: 'Liveness, readiness, and metrics' },
        { name: 'auth', description: 'Authentication and session lifecycle' },
        { name: 'organizations', description: 'Organization and membership management' },
      ],
    },
    transform: jsonSchemaTransform,
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });
};

export default fp(swaggerPlugin, { name: 'swagger', dependencies: ['container'] });
