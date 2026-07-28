import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { commonErrorResponses } from '../../lib/http.js';

export const searchRoutes: FastifyPluginAsync = async (app) => {
  const fastify = app.withTypeProvider<ZodTypeProvider>();

  fastify.post(
    '/v1/search',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['search'],
        summary: 'Hybrid retrieval over the organization knowledge base',
        body: z.object({
          query: z.string().min(1).max(2000),
          limit: z.number().int().min(1).max(50).optional(),
          collectionId: z.string().optional(),
        }),
        response: {
          200: z.object({
            hits: z.array(
              z.object({
                chunkId: z.string(),
                documentId: z.string(),
                title: z.string(),
                content: z.string(),
                score: z.number(),
              }),
            ),
          }),
          ...commonErrorResponses,
        },
      },
    },
    async (request) => {
      const auth = request.auth!;
      const hits = await fastify.container.services.search.search({
        organizationId: auth.organizationId,
        userId: auth.userId,
        role: auth.role,
        query: request.body.query,
        ...(request.body.limit !== undefined ? { limit: request.body.limit } : {}),
        ...(request.body.collectionId !== undefined
          ? { collectionId: request.body.collectionId }
          : {}),
      });
      return { hits };
    },
  );
};
