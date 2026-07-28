import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Role } from '@akp/core';
import { commonErrorResponses } from '../../lib/http.js';

export const teamRoutes: FastifyPluginAsync = async (app) => {
  const fastify = app.withTypeProvider<ZodTypeProvider>();

  fastify.post(
    '/v1/teams',
    {
      onRequest: [fastify.authenticate, fastify.requireRole(Role.ADMIN)],
      schema: {
        tags: ['teams'],
        body: z.object({
          name: z.string().min(1).max(100),
          description: z.string().max(500).optional(),
        }),
        response: {
          201: z.object({
            id: z.string(),
            name: z.string(),
            slug: z.string(),
            createdAt: z.string(),
          }),
          ...commonErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const team = await fastify.container.services.teams.create({
        organizationId: request.auth!.organizationId,
        userId: request.auth!.userId,
        name: request.body.name,
        ...(request.body.description !== undefined
          ? { description: request.body.description }
          : {}),
      });
      return reply.status(201).send({
        id: team.id,
        name: team.name,
        slug: team.slug,
        createdAt: team.createdAt.toISOString(),
      });
    },
  );

  fastify.get(
    '/v1/teams',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['teams'],
        response: {
          200: z.object({
            teams: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                slug: z.string(),
                memberCount: z.number(),
              }),
            ),
          }),
          ...commonErrorResponses,
        },
      },
    },
    async (request) => {
      const rows = await fastify.container.services.teams.list(request.auth!.organizationId);
      return {
        teams: rows.map((t) => ({
          id: t.id,
          name: t.name,
          slug: t.slug,
          memberCount: t.members.length,
        })),
      };
    },
  );

  fastify.post(
    '/v1/teams/:id/members',
    {
      onRequest: [fastify.authenticate, fastify.requireRole(Role.ADMIN)],
      schema: {
        tags: ['teams'],
        params: z.object({ id: z.string() }),
        body: z.object({
          userId: z.string(),
          role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']).default('MEMBER'),
        }),
        response: {
          201: z.object({ id: z.string(), userId: z.string(), role: z.string() }),
          ...commonErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const member = await fastify.container.services.teams.addMember(
        request.auth!.organizationId,
        request.params.id,
        request.body.userId,
        request.body.role,
      );
      return reply.status(201).send({
        id: member.id,
        userId: member.userId,
        role: member.role,
      });
    },
  );

  fastify.delete(
    '/v1/teams/:id',
    {
      onRequest: [fastify.authenticate, fastify.requireRole(Role.ADMIN)],
      schema: {
        tags: ['teams'],
        params: z.object({ id: z.string() }),
        response: { 204: z.null(), ...commonErrorResponses },
      },
    },
    async (request, reply) => {
      await fastify.container.services.teams.delete(
        request.auth!.organizationId,
        request.params.id,
        request.auth!.userId,
      );
      return reply.status(204).send(null);
    },
  );
};
