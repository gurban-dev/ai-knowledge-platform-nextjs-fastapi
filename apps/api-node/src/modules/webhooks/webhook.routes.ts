import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Role } from '@akp/core';
import { commonErrorResponses } from '../../lib/http.js';
import { WEBHOOK_EVENTS } from './webhook.service.js';

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  const fastify = app.withTypeProvider<ZodTypeProvider>();

  fastify.post(
    '/v1/webhooks/endpoints',
    {
      onRequest: [fastify.authenticate, fastify.requireRole(Role.ADMIN)],
      schema: {
        tags: ['webhooks'],
        body: z.object({
          url: z.string().url(),
          description: z.string().max(500).optional(),
          events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
        }),
        response: {
          201: z.object({
            id: z.string(),
            url: z.string(),
            events: z.array(z.string()),
            secret: z.string(),
            createdAt: z.string(),
          }),
          ...commonErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { endpoint, secret } = await fastify.container.services.webhooks.createEndpoint({
        organizationId: auth.organizationId,
        userId: auth.userId,
        url: request.body.url,
        ...(request.body.description !== undefined
          ? { description: request.body.description }
          : {}),
        events: [...request.body.events],
      });
      return reply.status(201).send({
        id: endpoint.id,
        url: endpoint.url,
        events: endpoint.events,
        secret,
        createdAt: endpoint.createdAt.toISOString(),
      });
    },
  );

  fastify.get(
    '/v1/webhooks/endpoints',
    {
      onRequest: [fastify.authenticate, fastify.requireRole(Role.ADMIN)],
      schema: {
        tags: ['webhooks'],
        response: {
          200: z.object({
            endpoints: z.array(
              z.object({
                id: z.string(),
                url: z.string(),
                events: z.array(z.string()),
                status: z.string(),
                createdAt: z.string(),
              }),
            ),
          }),
          ...commonErrorResponses,
        },
      },
    },
    async (request) => {
      const rows = await fastify.container.services.webhooks.listEndpoints(
        request.auth!.organizationId,
      );
      return {
        endpoints: rows.map((e) => ({
          id: e.id,
          url: e.url,
          events: e.events,
          status: e.status,
          createdAt: e.createdAt.toISOString(),
        })),
      };
    },
  );

  fastify.delete(
    '/v1/webhooks/endpoints/:id',
    {
      onRequest: [fastify.authenticate, fastify.requireRole(Role.ADMIN)],
      schema: {
        tags: ['webhooks'],
        params: z.object({ id: z.string() }),
        response: { 204: z.null(), ...commonErrorResponses },
      },
    },
    async (request, reply) => {
      await fastify.container.services.webhooks.deleteEndpoint(
        request.auth!.organizationId,
        request.params.id,
        request.auth!.userId,
      );
      return reply.status(204).send(null);
    },
  );
};
