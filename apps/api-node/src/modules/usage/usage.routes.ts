import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Role } from '@akp/core';
import { commonErrorResponses } from '../../lib/http.js';

export const usageRoutes: FastifyPluginAsync = async (app) => {
  const fastify = app.withTypeProvider<ZodTypeProvider>();

  fastify.get(
    '/v1/usage/summary',
    {
      onRequest: [fastify.authenticate, fastify.requireRole(Role.ADMIN)],
      schema: {
        tags: ['usage'],
        summary: 'Usage and cost summary for the current billing window',
        querystring: z.object({
          days: z.coerce.number().int().min(1).max(90).default(30),
        }),
        response: {
          200: z.object({
            spentMicros: z.string(),
            breakdown: z.array(
              z.object({
                kind: z.string(),
                model: z.string(),
                costMicros: z.string(),
                totalTokens: z.string(),
                events: z.number(),
              }),
            ),
          }),
          ...commonErrorResponses,
        },
      },
    },
    async (request) => {
      const since = new Date(Date.now() - request.query.days * 86_400_000);
      return fastify.container.services.usage.summary(request.auth!.organizationId, since);
    },
  );
};
