import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

/**
 * Operational endpoints for orchestrators and uptime monitors:
 *   - GET /health/live  : process is up (no dependency checks) — for k8s liveness.
 *   - GET /health/ready : dependencies (Postgres, Redis) reachable — for readiness.
 *
 * Liveness must never fail on dependency issues, otherwise Kubernetes would
 * restart a healthy pod during a transient DB blip. Readiness gates traffic.
 */
const livenessSchema = z.object({
  status: z.literal('ok'),
  uptime: z.number().describe('Process uptime in seconds'),
  timestamp: z.string(),
});

const readinessSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.object({
    database: z.enum(['up', 'down']),
    redis: z.enum(['up', 'down']),
  }),
  timestamp: z.string(),
});

export const healthRoutes: FastifyPluginAsync = async (app) => {
  const fastify = app.withTypeProvider<ZodTypeProvider>();

  fastify.get(
    '/health/live',
    {
      schema: {
        tags: ['health'],
        summary: 'Liveness probe',
        response: { 200: livenessSchema },
      },
      config: { rateLimit: false },
    },
    async () => ({
      status: 'ok' as const,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    }),
  );

  fastify.get(
    '/health/ready',
    {
      schema: {
        tags: ['health'],
        summary: 'Readiness probe',
        response: { 200: readinessSchema, 503: readinessSchema },
      },
      config: { rateLimit: false },
    },
    async (_request, reply) => {
      const { prisma, redis } = fastify.container;

      const checkDatabase = async (): Promise<'up' | 'down'> => {
        try {
          await prisma.$queryRaw`SELECT 1`;
          return 'up';
        } catch {
          return 'down';
        }
      };

      const checkRedis = async (): Promise<'up' | 'down'> => {
        try {
          return (await redis.ping()) === 'PONG' ? 'up' : 'down';
        } catch {
          return 'down';
        }
      };

      const [database, cache] = await Promise.all([checkDatabase(), checkRedis()]);
      const healthy = database === 'up' && cache === 'up';
      void reply.status(healthy ? 200 : 503);
      return {
        status: healthy ? ('ok' as const) : ('degraded' as const),
        checks: { database, redis: cache },
        timestamp: new Date().toISOString(),
      };
    },
  );
};
