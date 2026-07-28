import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { commonErrorResponses } from '../../lib/http.js';

const incidentResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  incidentChannel: z.string(),
  runbookUrl: z.string().url(),
  // Reported from infrastructure configuration — never fabricated. When backups
  // are not wired to the API, this is explicitly 'not_configured'.
  backup: z.object({
    provider: z.string().nullable(),
    configured: z.boolean(),
    lastRestoreTestAt: z.string().nullable(),
  }),
  dependencies: z.object({
    database: z.enum(['up', 'down']),
    redis: z.enum(['up', 'down']),
  }),
  timestamp: z.string(),
});

export const incidentRoutes: FastifyPluginAsync = async (app) => {
  const fastify = app.withTypeProvider<ZodTypeProvider>();

  fastify.get(
    '/v1/operations/incident-response',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['operations'],
        summary: 'Return reliability and incident-response status',
        security: [{ bearerAuth: [] }],
        response: { 200: incidentResponseSchema, ...commonErrorResponses },
      },
    },
    async () => {
      const { config, prisma, redis } = fastify.container;
      const [database, cache] = await Promise.all([
        prisma
          .$queryRaw`SELECT 1`
          .then(() => 'up' as const)
          .catch(() => 'down' as const),
        redis
          .ping()
          .then((r) => (r === 'PONG' ? ('up' as const) : ('down' as const)))
          .catch(() => 'down' as const),
      ]);
      const healthy = database === 'up' && cache === 'up';
      return {
        status: healthy ? ('ok' as const) : ('degraded' as const),
        incidentChannel: config.operations.incidentChannel,
        runbookUrl: config.operations.runbookUrl,
        backup: {
          provider: config.operations.backupProvider ?? null,
          configured: Boolean(config.operations.backupProvider),
          lastRestoreTestAt: config.operations.lastRestoreTestAt ?? null,
        },
        dependencies: { database, redis: cache },
        timestamp: new Date().toISOString(),
      };
    },
  );
};
