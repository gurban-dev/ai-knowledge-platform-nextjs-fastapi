import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import type { AppContainer } from '../container.js';

/** Attaches the composition-root container to the Fastify instance. */
const containerPlugin: FastifyPluginAsync<{ container: AppContainer }> = async (
  fastify,
  opts,
) => {
  fastify.decorate('container', opts.container);
};

export default fp(containerPlugin, { name: 'container' });
