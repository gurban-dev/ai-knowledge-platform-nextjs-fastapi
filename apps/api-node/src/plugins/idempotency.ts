import { createHash } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { IdPrefix, IdempotencyConflictError, newId } from '@akp/core';

/**
 * Honors `Idempotency-Key` on mutating authenticated requests.
 * Replays the stored response when the same key+body is retried; conflicts when
 * the key is reused with a different payload hash.
 */
const idempotencyPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return;
    const keyHeader = request.headers['idempotency-key'];
    if (typeof keyHeader !== 'string' || !keyHeader.trim()) return;
    if (!request.auth) return;

    const bodyText =
      typeof request.body === 'string' ? request.body : JSON.stringify(request.body ?? {});
    const requestHash = createHash('sha256').update(bodyText).digest('hex');
    const organizationId = request.auth.organizationId;
    const existing = await fastify.container.prisma.idempotencyKey.findUnique({
      where: {
        organizationId_key: { organizationId, key: keyHeader.trim() },
      },
    });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new IdempotencyConflictError();
      }
      if (existing.status === 'COMPLETED' && existing.responseBody != null) {
        return reply.status(existing.responseStatus ?? 200).send(existing.responseBody);
      }
      return;
    }

    const ttl = fastify.container.config.idempotency.ttlSeconds;
    await fastify.container.prisma.idempotencyKey.create({
      data: {
        id: newId(IdPrefix.idempotencyKey),
        organizationId,
        key: keyHeader.trim(),
        method: request.method,
        path: request.url,
        requestHash,
        status: 'IN_PROGRESS',
        expiresAt: new Date(Date.now() + ttl * 1000),
      },
    });

    const originalSend = reply.send.bind(reply);
    reply.send = ((payload: unknown) => {
      void fastify.container.prisma.idempotencyKey
        .updateMany({
          where: { organizationId, key: keyHeader.trim(), status: 'IN_PROGRESS' },
          data: {
            status: 'COMPLETED',
            responseStatus: reply.statusCode,
            responseBody: payload as object,
          },
        })
        .catch(() => undefined);
      return originalSend(payload);
    });
  });
};

export default fp(idempotencyPlugin, {
  name: 'idempotency',
  dependencies: ['container', 'auth'],
});
