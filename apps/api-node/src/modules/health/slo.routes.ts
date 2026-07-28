import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { commonErrorResponses } from '../../lib/http.js';

const sloSchema = z.object({
  service: z.string(),
  availabilityTarget: z.string(),
  latencyBudgetMs: z.number(),
  errorBudgetMinutesPerMonth: z.number(),
  alertingThreshold: z.string(),
  // Live runtime signals. Burn-rate and long-window availability are computed by
  // the monitoring stack from the Prometheus /metrics endpoint; the API exposes
  // the objective definitions plus current dependency health and uptime.
  metricsEndpoint: z.string(),
  current: z.object({
    uptimeSeconds: z.number(),
    dependencies: z.object({
      database: z.enum(['up', 'down']),
      redis: z.enum(['up', 'down']),
    }),
  }),
});

export const sloRoutes: FastifyPluginAsync = async (app) => {
  const fastify = app.withTypeProvider<ZodTypeProvider>();

  fastify.get(
    '/v1/observability/slo',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['observability'],
        summary: 'Expose service-level objectives, thresholds, and live health',
        security: [{ bearerAuth: [] }],
        response: { 200: sloSchema, ...commonErrorResponses },
      },
    },
    async () => {
      const { config, prisma, redis } = fastify.container;
      const { slo, serviceName } = config.observability;

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

      return {
        service: serviceName,
        availabilityTarget: slo.availabilityTarget,
        latencyBudgetMs: slo.latencyBudgetMs,
        errorBudgetMinutesPerMonth: slo.errorBudgetMinutesPerMonth,
        alertingThreshold: slo.burnAlertThreshold,
        metricsEndpoint: '/metrics',
        current: {
          uptimeSeconds: Math.round(process.uptime()),
          dependencies: { database, redis: cache },
        },
      };
    },
  );
};
