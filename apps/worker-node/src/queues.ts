import type { ConnectionOptions } from 'bullmq';

export const QueueName = {
  Ingest: 'ingest',
  Webhook: 'webhook',
  Maintenance: 'maintenance',
} as const;

export function queueKey(_prefix: string, name: string): string {
  return name;
}

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
