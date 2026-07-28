import { Worker } from 'bullmq';
import { getConfig } from '@akp/config';
import { FieldEncryptor, StaticKeyProvider } from '@akp/core';
import { createPrismaClient } from '@akp/db';
import { createLogger } from '@akp/observability';
import { createObjectStorage } from '@akp/storage';
import { createWorkerAi, ingestDocument } from './ingest.js';
import { QueueName, queueKey, redisUrlToConnection } from './queues.js';
import { deliverWebhook } from './webhook-deliver.js';

function parsePiiSetting(raw: unknown): boolean {
  if (raw && typeof raw === 'object' && 'piiRedactionEnabled' in raw) {
    return Boolean((raw as { piiRedactionEnabled?: unknown }).piiRedactionEnabled);
  }
  return true;
}

function main(): void {
  const config = getConfig();
  const logger = createLogger({
    serviceName: 'akp-worker',
    level: config.logLevel,
    pretty: !config.isProduction,
  });
  const prisma = createPrismaClient({ databaseUrl: config.database.url });
  const storage = createObjectStorage({
    backend: config.storage.backend,
    localRoot: config.storage.localRoot,
    bucket: config.storage.bucket,
    gcsAccessToken: config.storage.gcsAccessToken,
  });
  const ai = createWorkerAi(
    config.ai.forceFake,
    config.ai.openaiApiKey,
    config.ai.anthropicApiKey,
  );
  const encryptor = new FieldEncryptor(
    new StaticKeyProvider({
      activeKeyId: config.security.encryption.activeKeyId,
      keys: { ...config.security.encryption.keys },
    }),
  );

  const connection = redisUrlToConnection(config.redis.url);

  const ingestWorker = new Worker(
    queueKey(config.queue.prefix, QueueName.Ingest),
    async (job) => {
      const data = job.data as {
        type: string;
        organizationId: string;
        documentId?: string;
        jobId: string;
      };
      if (data.type !== 'INGEST_DOCUMENT' || !data.documentId) {
        logger.warn({ type: data.type }, 'Unsupported ingest job type');
        return;
      }
      const org = await prisma.organization.findUnique({
        where: { id: data.organizationId },
      });
      await ingestDocument(
        {
          prisma,
          storage,
          ai,
          logger,
          embeddingModel: config.ai.embeddingModel,
          embeddingDimensions: config.ai.embeddingDimensions,
          piiRedactionEnabled: parsePiiSetting(org?.settings),
        },
        {
          organizationId: data.organizationId,
          documentId: data.documentId,
          jobId: data.jobId,
        },
      );
    },
    {
      connection,
      prefix: config.queue.prefix,
      concurrency: config.queue.ingestConcurrency,
    },
  );

  const webhookWorker = new Worker(
    queueKey(config.queue.prefix, QueueName.Webhook),
    async (job) => {
      const data = job.data as { deliveryId: string };
      await deliverWebhook(prisma, encryptor, data.deliveryId, config.webhooks.timeoutMs);
    },
    {
      connection,
      prefix: config.queue.prefix,
      concurrency: config.queue.webhookConcurrency,
    },
  );

  const maintenanceWorker = new Worker(
    queueKey(config.queue.prefix, QueueName.Maintenance),
    async (job) => {
      const data = job.data as { type: string };
      if (data.type === 'RETENTION_SWEEP') {
        const deleted = await prisma.idempotencyKey.deleteMany({
          where: { expiresAt: { lt: new Date() } },
        });
        logger.info({ deleted: deleted.count }, 'Retention sweep completed');
      }
    },
    {
      connection,
      prefix: config.queue.prefix,
      concurrency: 1,
    },
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down workers');
    await Promise.all([ingestWorker.close(), webhookWorker.close(), maintenanceWorker.close()]);
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  logger.info('AKP worker started');
}

main();