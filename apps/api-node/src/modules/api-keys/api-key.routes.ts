import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ALL_API_SCOPES, ApiScope, FeatureDisabledError, Role } from '@akp/core';
import { commonErrorResponses } from '../../lib/http.js';

const scopeSchema = z.enum([ApiScope.Wildcard, ...ALL_API_SCOPES] as [string, ...string[]]);

const createApiKeyBodySchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  scopes: z.array(scopeSchema).min(1),
  rateLimitPerMinute: z.number().int().min(1).max(10_000).optional(),
  ipAllowlist: z.array(z.string().min(1).max(64)).max(50).optional(),
  expiresAt: z.string().datetime().optional(),
});

const apiKeySchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  prefix: z.string(),
  status: z.string(),
  scopes: z.array(z.string()),
  rateLimitPerMinute: z.number().int().nullable(),
  ipAllowlist: z.array(z.string()),
  createdById: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  lastRotatedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
});

const createApiKeyResponseSchema = z.object({
  // The plaintext secret is returned exactly once, at creation/rotation.
  secret: z.string(),
  key: apiKeySchema,
});

const listApiKeysResponseSchema = z.object({ keys: z.array(apiKeySchema) });

const currentApiKeySchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  scopes: z.array(z.string()),
});

export const apiKeyRoutes: FastifyPluginAsync = async (app) => {
  const fastify = app.withTypeProvider<ZodTypeProvider>();
  const { apiKeys, organizations } = fastify.container.services;

  async function assertApiKeysEnabled(organizationId: string): Promise<void> {
    const settings = await organizations.getSettings(organizationId);
    if (!settings.allowApiKeys) {
      throw new FeatureDisabledError('API keys are disabled for this organization');
    }
  }

  fastify.post(
    '/v1/api-keys',
    {
      onRequest: [fastify.authenticate, fastify.requireRole(Role.ADMIN)],
      schema: {
        tags: ['api-keys'],
        summary: 'Create an organization-scoped API key',
        security: [{ bearerAuth: [] }],
        body: createApiKeyBodySchema,
        response: { 201: createApiKeyResponseSchema, ...commonErrorResponses },
      },
    },
    async (request, reply) => {
      const organizationId = request.auth!.organizationId;
      await assertApiKeysEnabled(organizationId);
      const result = await apiKeys.create({
        organizationId,
        name: request.body.name,
        description: request.body.description,
        scopes: request.body.scopes,
        rateLimitPerMinute: request.body.rateLimitPerMinute,
        ipAllowlist: request.body.ipAllowlist,
        createdById: request.auth!.userId,
        expiresAt: request.body.expiresAt ? new Date(request.body.expiresAt) : undefined,
      });
      void reply.status(201);
      return result;
    },
  );

  fastify.get(
    '/v1/api-keys',
    {
      onRequest: [fastify.authenticate, fastify.requireRole(Role.ADMIN)],
      schema: {
        tags: ['api-keys'],
        summary: 'List organization API keys',
        security: [{ bearerAuth: [] }],
        response: { 200: listApiKeysResponseSchema, ...commonErrorResponses },
      },
    },
    async (request) => ({ keys: await apiKeys.list(request.auth!.organizationId) }),
  );

  fastify.post(
    '/v1/api-keys/:id/rotate',
    {
      onRequest: [fastify.authenticate, fastify.requireRole(Role.ADMIN)],
      schema: {
        tags: ['api-keys'],
        summary: 'Rotate an API key secret',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string() }),
        response: { 200: createApiKeyResponseSchema, ...commonErrorResponses },
      },
    },
    async (request) => apiKeys.rotate(request.params.id, request.auth!.organizationId),
  );

  fastify.delete(
    '/v1/api-keys/:id',
    {
      onRequest: [fastify.authenticate, fastify.requireRole(Role.ADMIN)],
      schema: {
        tags: ['api-keys'],
        summary: 'Revoke an API key',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string() }),
        response: { 204: z.null(), ...commonErrorResponses },
      },
    },
    async (request, reply) => {
      await apiKeys.revoke(request.params.id, request.auth!.organizationId);
      void reply.status(204);
      return null;
    },
  );

  // Programmatic identity check: authenticates via the API key itself.
  fastify.get(
    '/v1/api-keys/current',
    {
      onRequest: [fastify.authenticateApiKey],
      schema: {
        tags: ['api-keys'],
        summary: 'Return the identity of the calling API key',
        response: { 200: currentApiKeySchema, ...commonErrorResponses },
      },
    },
    (request) => {
      const key = request.apiKey!;
      return {
        id: key.id,
        organizationId: key.organizationId,
        name: key.name,
        scopes: key.scopes,
      };
    },
  );
};
