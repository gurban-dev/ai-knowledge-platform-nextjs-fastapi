import { createHmac, randomBytes } from 'node:crypto';
import { IdPrefix, newId, NotFoundError } from '@akp/core';
import type { FieldEncryptor } from '@akp/core';
import type { Prisma, PrismaClient, WebhookEndpoint } from '@akp/db';
import type { Queue } from 'bullmq';
import type { QueueJobPayloads } from '../../lib/queues.js';
import { type QueueName } from '../../lib/queues.js';
import type { AuditService } from '../audit/audit.service.js';
import { AuditAction } from '../audit/audit.service.js';

export const WEBHOOK_EVENTS = [
  'ingestion.completed',
  'ingestion.failed',
  'evaluation.completed',
  'budget.alert',
  'document.deleted',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function signWebhookPayload(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const base = `${timestamp}.${body}`;
  const sig = createHmac('sha256', secret).update(base).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

export class WebhookService {
  constructor(
    private readonly deps: {
      prisma: PrismaClient;
      encryptor: FieldEncryptor;
      audit: AuditService;
      webhookQueue: Queue<QueueJobPayloads[typeof QueueName.Webhook]>;
      maxAttempts: number;
    },
  ) {}

  async createEndpoint(params: {
    organizationId: string;
    userId: string;
    url: string;
    description?: string;
    events: string[];
  }): Promise<{ endpoint: WebhookEndpoint; secret: string }> {
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    const endpoint = await this.deps.prisma.webhookEndpoint.create({
      data: {
        id: newId(IdPrefix.webhookEndpoint),
        organizationId: params.organizationId,
        url: params.url,
        description: params.description ?? null,
        secretCiphertext: this.deps.encryptor.encrypt(secret),
        events: params.events,
        createdById: params.userId,
      },
    });
    await this.deps.audit.record({
      organizationId: params.organizationId,
      actorUserId: params.userId,
      action: AuditAction.WebhookEndpointCreated,
      resourceType: 'webhook_endpoint',
      resourceId: endpoint.id,
    });
    return { endpoint, secret };
  }

  async listEndpoints(organizationId: string) {
    return this.deps.prisma.webhookEndpoint.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteEndpoint(organizationId: string, id: string, userId: string) {
    const existing = await this.deps.prisma.webhookEndpoint.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundError('Webhook endpoint');
    await this.deps.prisma.webhookEndpoint.delete({ where: { id } });
    await this.deps.audit.record({
      organizationId,
      actorUserId: userId,
      action: AuditAction.WebhookEndpointDeleted,
      resourceType: 'webhook_endpoint',
      resourceId: id,
    });
  }

  async enqueueEvent(
    organizationId: string,
    eventType: WebhookEvent,
    payload: Prisma.InputJsonValue,
  ): Promise<number> {
    const endpoints = await this.deps.prisma.webhookEndpoint.findMany({
      where: { organizationId, status: 'ACTIVE', events: { has: eventType } },
    });
    let count = 0;
    for (const endpoint of endpoints) {
      const deliveryId = newId(IdPrefix.webhookDelivery);
      await this.deps.prisma.webhookDelivery.create({
        data: {
          id: deliveryId,
          organizationId,
          endpointId: endpoint.id,
          eventType,
          payload,
          status: 'PENDING',
          nextAttemptAt: new Date(),
        },
      });
      await this.deps.webhookQueue.add(
        'deliver',
        { deliveryId, organizationId },
        { jobId: deliveryId, attempts: this.deps.maxAttempts, backoff: { type: 'exponential', delay: 2000 } },
      );
      count += 1;
    }
    return count;
  }

  async deliver(deliveryId: string): Promise<void> {
    const delivery = await this.deps.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { endpoint: true },
    });
    if (!delivery?.endpoint) return;
    const secret = this.deps.encryptor.decrypt(delivery.endpoint.secretCiphertext);
    const body = JSON.stringify({
      id: delivery.id,
      type: delivery.eventType,
      createdAt: delivery.createdAt.toISOString(),
      data: delivery.payload,
    });
    const signature = signWebhookPayload(secret, body);
    try {
      const res = await fetch(delivery.endpoint.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-akp-signature': signature,
          'x-akp-event': delivery.eventType,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await this.deps.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'SUCCEEDED',
          attempts: { increment: 1 },
          responseStatus: res.status,
          deliveredAt: new Date(),
          lastError: null,
        },
      });
    } catch (error) {
      const attempts = delivery.attempts + 1;
      const dead = attempts >= this.deps.maxAttempts;
      await this.deps.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: dead ? 'DEAD' : 'FAILED',
          attempts,
          lastError: error instanceof Error ? error.message : String(error),
          nextAttemptAt: dead ? null : new Date(Date.now() + attempts * 5000),
        },
      });
      if (!dead) throw error;
    }
  }
}
