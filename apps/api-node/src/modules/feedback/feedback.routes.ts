import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { IdPrefix, newId, NotFoundError } from '@akp/core';
import { commonErrorResponses } from '../../lib/http.js';
import { AuditAction } from '../audit/audit.service.js';

export const feedbackRoutes: FastifyPluginAsync = async (app) => {
  const fastify = app.withTypeProvider<ZodTypeProvider>();

  fastify.put(
    '/v1/messages/:messageId/feedback',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['feedback'],
        params: z.object({ messageId: z.string() }),
        body: z.object({
          rating: z.enum(['UP', 'DOWN']),
          reason: z.enum(['INCORRECT', 'INCOMPLETE', 'OUTDATED', 'UNSAFE', 'OTHER']).optional(),
          comment: z.string().max(2000).optional(),
        }),
        response: {
          200: z.object({
            id: z.string(),
            rating: z.string(),
            createdAt: z.string(),
          }),
          ...commonErrorResponses,
        },
      },
    },
    async (request) => {
      const auth = request.auth!;
      const message = await fastify.container.prisma.message.findFirst({
        where: {
          id: request.params.messageId,
          organizationId: auth.organizationId,
        },
      });
      if (!message) throw new NotFoundError('Message');

      const row = await fastify.container.prisma.messageFeedback.upsert({
        where: {
          messageId_userId: {
            messageId: request.params.messageId,
            userId: auth.userId,
          },
        },
        create: {
          id: newId(IdPrefix.messageFeedback),
          organizationId: auth.organizationId,
          messageId: request.params.messageId,
          userId: auth.userId,
          rating: request.body.rating,
          reason: request.body.reason ?? null,
          comment: request.body.comment ?? null,
        },
        update: {
          rating: request.body.rating,
          reason: request.body.reason ?? null,
          comment: request.body.comment ?? null,
        },
      });

      await fastify.container.services.audit.record({
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: AuditAction.FeedbackSubmitted,
        resourceType: 'message',
        resourceId: request.params.messageId,
        metadata: { rating: request.body.rating },
      });

      return {
        id: row.id,
        rating: row.rating,
        createdAt: row.createdAt.toISOString(),
      };
    },
  );
};
