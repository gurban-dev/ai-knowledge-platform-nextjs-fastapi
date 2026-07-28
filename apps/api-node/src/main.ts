import { initTracing, shutdownTracing } from '@akp/observability/tracing';
import { createLogger } from '@akp/observability';
import { config } from './config.js';

// Initialize tracing BEFORE importing any instrumented module (Fastify, pg,
// ioredis). Auto-instrumentation can only patch modules loaded after this call.
initTracing({
  enabled: config.observability.otelEnabled,
  serviceName: config.observability.serviceName,
  environment: config.env,
  ...(config.observability.otelEndpoint ? { otlpEndpoint: config.observability.otelEndpoint } : {}),
});

const logger = createLogger({
  level: config.logLevel,
  serviceName: config.observability.serviceName,
  pretty: !config.isProduction,
});

async function main(): Promise<void> {
  // Deferred imports so the modules above are loaded post-instrumentation.
  const [{ buildApp }, { getPrismaClient }, { Redis }, { buildContainer }] =
    await Promise.all([
      import('./app.js'),
      import('@akp/db'),
      import('ioredis'),
      import('./container.js'),
    ]);

  const prisma = getPrismaClient({ databaseUrl: config.database.url });
  const redis = new Redis(config.redis.url, { maxRetriesPerRequest: null });

  const container = buildContainer({ config, logger, prisma, redis });
  const app = await buildApp({ container });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down');
    try {
      await app.close();
      await prisma.$disconnect();
      redis.disconnect();
      await shutdownTracing();
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'Error during shutdown');
      process.exit(1);
    }
  };

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => void shutdown(signal));
  }

  await app.listen({ host: config.server.host, port: config.server.port });
  logger.info(
    { url: config.server.publicUrl, docs: `${config.server.publicUrl}/docs` },
    'API server listening',
  );
}

main().catch((error) => {
  logger.fatal({ err: error }, 'Failed to start API server');
  process.exit(1);
});
