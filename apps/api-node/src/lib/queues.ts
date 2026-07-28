import { Queue, type ConnectionOptions } from 'bullmq';

export const QueueName = {
  Ingest: 'ingest',
  Webhook: 'webhook',
  Maintenance: 'maintenance',
} as const;

export type QueueName = (typeof QueueName)[keyof typeof QueueName];

export interface QueueJobPayloads {
  [QueueName.Ingest]: {
    type: 'INGEST_DOCUMENT' | 'SYNC_SOURCE' | 'REEMBED' | 'EVALUATE';
    organizationId: string;
    documentId?: string;
    dataSourceId?: string;
    evaluationId?: string;
    jobId: string;
  };
  [QueueName.Webhook]: {
    deliveryId: string;
    organizationId: string;
  };
  [QueueName.Maintenance]: {
    type: 'RETENTION_SWEEP' | 'WEBHOOK_RETRY';
    organizationId?: string;
  };
}

export type IngestJobPayload = QueueJobPayloads[typeof QueueName.Ingest];

export type WebhookJobPayload = QueueJobPayloads[typeof QueueName.Webhook];

export type MaintenanceJobPayload = QueueJobPayloads[typeof QueueName.Maintenance];

export function queueKey(_prefix: string, name: string): string {
  return name;
}

/** Parse redis://host:port/db into BullMQ connection options. */
export function redisUrlToConnection(url: string): ConnectionOptions {
  const parsed = new URL(url);

  return {
    host: parsed.hostname || '127.0.0.1',
    port: parsed.port ? Number(parsed.port) : 6379,
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
    maxRetriesPerRequest: null,
  };
}

export function createQueues(
  prefix: string,
  redisUrl: string,
): {
  ingest: Queue<QueueJobPayloads[typeof QueueName.Ingest]>;
  webhook: Queue<QueueJobPayloads[typeof QueueName.Webhook]>;
  maintenance: Queue<QueueJobPayloads[typeof QueueName.Maintenance]>;
} {
  const connection = redisUrlToConnection(redisUrl);

  const ingest = new Queue<QueueJobPayloads[typeof QueueName.Ingest]>(
    queueKey(prefix, QueueName.Ingest),
    {
      connection,
      prefix,
    },
  );

  const webhook = new Queue<QueueJobPayloads[typeof QueueName.Webhook]>(
    queueKey(prefix, QueueName.Webhook),
    {
      connection,
      prefix,
    },
  );

  const maintenance = new Queue<QueueJobPayloads[typeof QueueName.Maintenance]>(
    queueKey(prefix, QueueName.Maintenance),
    {
      connection,
      prefix,
    },
  );

  return {
    ingest,
    webhook,
    maintenance,
  };
}