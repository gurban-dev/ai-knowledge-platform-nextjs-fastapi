import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Role } from '@akp/core';
import { commonErrorResponses, paginationQuerySchema } from '../../lib/http.js';

const auditLogSchema = z.object({
  id: z.string(),
  action: z.string(),
  actorUserId: z.string().nullable(),
  resourceType: z.string().nullable(),
  resourceId: z.string().nullable(),
  ipAddress: z.string().nullable(),
  metadata: z.unknown(),
  createdAt: z.string(),
});

export const auditRoutes: FastifyPluginAsync = async (app) => {
  const fastify = app.withTypeProvider<ZodTypeProvider>();
  const { audit } = fastify.container.services;

  fastify.get(
    '/v1/audit-logs',
    {
      // Audit trails are sensitive; restrict to admins and owners.
      onRequest: [fastify.authenticate, fastify.requireRole(Role.ADMIN)],
      schema: {
        tags: ['audit'],
        summary: 'List the organization audit trail (append-only, newest first)',
        security: [{ bearerAuth: [] }],
        querystring: paginationQuerySchema,
        response: {
          200: z.object({
            logs: z.array(auditLogSchema),
            nextCursor: z.string().nullable(),
          }),
          ...commonErrorResponses,
        },
      },
    },
    async (request) =>
      audit.list(request.auth!.organizationId, {
        limit: request.query.limit,
        cursor: request.query.cursor,
      }),
  );
};
