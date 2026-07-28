import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Role } from '@akp/core';
import { hashPassword } from '../../lib/crypto.js';
import { commonErrorResponses } from '../../lib/http.js';

export const inviteRoutes: FastifyPluginAsync = async (app) => {
  const fastify = app.withTypeProvider<ZodTypeProvider>();

  fastify.post(
    '/v1/invites',
    {
      onRequest: [fastify.authenticate, fastify.requireRole(Role.ADMIN)],
      schema: {
        tags: ['invites'],
        body: z.object({
          email: z.string().email(),
          role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']).default('MEMBER'),
        }),
        response: {
          201: z.object({
            id: z.string(),
            email: z.string(),
            role: z.string(),
            token: z.string(),
            expiresAt: z.string(),
          }),
          ...commonErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const { invite, token } = await fastify.container.services.invites.create({
        organizationId: request.auth!.organizationId,
        email: request.body.email,
        role: request.body.role,
        invitedById: request.auth!.userId,
      });
      return reply.status(201).send({
        id: invite.id,
        email: invite.email,
        role: invite.role,
        token,
        expiresAt: invite.expiresAt.toISOString(),
      });
    },
  );

  fastify.get(
    '/v1/invites',
    {
      onRequest: [fastify.authenticate, fastify.requireRole(Role.ADMIN)],
      schema: {
        tags: ['invites'],
        response: {
          200: z.object({
            invites: z.array(
              z.object({
                id: z.string(),
                email: z.string(),
                role: z.string(),
                expiresAt: z.string(),
              }),
            ),
          }),
          ...commonErrorResponses,
        },
      },
    },
    async (request) => {
      const rows = await fastify.container.services.invites.list(request.auth!.organizationId);
      return {
        invites: rows.map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role,
          expiresAt: i.expiresAt.toISOString(),
        })),
      };
    },
  );

  fastify.post(
    '/v1/invites/accept',
    {
      schema: {
        tags: ['invites'],
        body: z.object({
          token: z.string().min(10),
          name: z.string().min(1),
          password: z.string().min(8),
        }),
        response: {
          200: z.object({
            userId: z.string(),
            organizationId: z.string(),
            role: z.string(),
          }),
          ...commonErrorResponses,
        },
      },
    },
    async (request) => {
      const passwordHash = await hashPassword(
        request.body.password,
        fastify.container.config.auth.passwordHashMemoryCost,
      );
      return fastify.container.services.invites.accept({
        token: request.body.token,
        name: request.body.name,
        passwordHash,
      });
    },
  );
};
