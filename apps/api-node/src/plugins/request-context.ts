import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Surfaces the per-request correlation id to clients via the `x-request-id`
 * response header. Fastify already threads `request.id` through `request.log`,
 * so downstream logs and the error envelope share the same id for tracing.
 */
const requestContextPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onSend', (request, reply, payload, done) => {
    void reply.header('x-request-id', request.id);
    done(null, payload);
  });
};

export default fp(requestContextPlugin, { name: 'request-context' });
