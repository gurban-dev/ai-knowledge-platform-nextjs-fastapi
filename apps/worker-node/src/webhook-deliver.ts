import { createHmac } from 'node:crypto';
import type { FieldEncryptor } from '@akp/core';
import type { PrismaClient } from '@akp/db';

export function signWebhookPayload(
  secret: string,
  body: string,
  timestamp = Math.floor(Date.now() / 1000),
): string {
  const base = `${timestamp}.${body}`;
  const sig = createHmac('sha256', secret).update(base).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

export async function deliverWebhook(
  prisma: PrismaClient,
  encryptor: FieldEncryptor,
  deliveryId: string,
  timeoutMs: number,
): Promise<void> {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { endpoint: true },
  });
  if (!delivery?.endpoint) return;

  const secret = encryptor.decrypt(delivery.endpoint.secretCiphertext);
  const body = JSON.stringify({
    id: delivery.id,
    type: delivery.eventType,
    createdAt: delivery.createdAt.toISOString(),
    data: delivery.payload,
  });
  const signature = signWebhookPayload(secret, body);
  const res = await fetch(delivery.endpoint.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-akp-signature': signature,
      'x-akp-event': delivery.eventType,
    },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Webhook delivery HTTP ${res.status}`);
  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      status: 'SUCCEEDED',
      attempts: { increment: 1 },
      responseStatus: res.status,
      deliveredAt: new Date(),
      lastError: null,
    },
  });
}
