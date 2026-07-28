import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Prometheus metrics endpoint. Instruments live on the shared `AppMetrics`
 * catalog constructed in the composition root so HTTP and AI metrics share a
 * single registry. This hook records per-request latency/count labeled by
 * method, route template (not raw path, to bound label cardinality), and status.
 */
const metricsPlugin: FastifyPluginAsync = async (fastify) => {
  const { metrics } = fastify.container;

  fastify.addHook('onResponse', (request, reply, done) => {
    const route = request.routeOptions.url ?? 'unknown';
    const labels = {
      method: request.method,
      route,
      status_code: String(reply.statusCode),
    };
    metrics.httpRequestDuration.observe(labels, reply.elapsedTime / 1000);
    metrics.httpRequestsTotal.inc(labels);
    done();
  });

  fastify.get(
    '/metrics',
    { schema: { hide: true }, config: { rateLimit: false } },
    async (_request, reply) => {
      void reply.header('content-type', metrics.contentType());
      return metrics.render();
    },
  );
};

export default fp(metricsPlugin, { name: 'metrics', dependencies: ['container'] });
