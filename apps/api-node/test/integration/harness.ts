import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import type { Redis as RedisClient } from 'ioredis';
import { chunkText } from '@akp/ai';
import { loadConfig } from '@akp/config';
import { IdPrefix, newId } from '@akp/core';
import { createPrismaClient, toVectorLiteral, type PrismaClient } from '@akp/db';
import { createLogger } from '@akp/observability';
import { buildApp } from '../../src/app.js';
import { buildContainer, type AppContainer } from '../../src/container.js';
import type { GoogleOAuthProvider } from '../../src/lib/google-oauth.js';

/** Integration tests run only when a test database is configured. */
export const INTEGRATION_ENABLED = Boolean(process.env.TEST_DATABASE_URL);

export interface TestHarness {
  app: FastifyInstance;
  container: AppContainer;
  prisma: PrismaClient;
  redis: RedisClient;
  /**
   * Synchronously run the ingestion pipeline for a document. Mirrors
   * `apps/worker/src/ingest.ts` (load → chunk → embed → write pgvector rows →
   * mark INDEXED) so retrieval flows can be exercised without booting a
   * separate worker process. Uses the container's configured AI + storage, so
   * the deterministic FakeAiProvider keeps runs reproducible in CI.
   */
  ingest: (organizationId: string, documentId: string) => Promise<number>;
  reset: () => Promise<void>;
  close: () => Promise<void>;
}

export interface HarnessOptions {
  /**
   * Substitute the Google OAuth provider with a deterministic fake and enable
   * the feature, so the Google sign-in endpoints can be exercised without real
   * Google credentials or network access.
   */
  googleOAuth?: GoogleOAuthProvider;
}

/**
 * Spin up the real Fastify app wired to the test Postgres + Redis. Tests drive
 * it through `app.inject()` (no network socket) for speed and determinism.
 */
export async function createHarness(options: HarnessOptions = {}): Promise<TestHarness> {
  const databaseUrl = process.env.TEST_DATABASE_URL!;
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? 'test-access-secret-000000000000000000000',
    JWT_REFRESH_SECRET:
      process.env.JWT_REFRESH_SECRET ?? 'test-refresh-secret-11111111111111111111',
    // Keep hashing cheap in tests.
    PASSWORD_HASH_MEMORY_COST: '8192',
    // Flip on Google sign-in when a fake provider is injected.
    ...(options.googleOAuth
      ? { GOOGLE_CLIENT_ID: 'test-google-client', GOOGLE_CLIENT_SECRET: 'test-google-secret' }
      : {}),
  });

  const logger = createLogger({ level: 'silent', serviceName: 'akp-api-test' });
  const prisma = createPrismaClient({ databaseUrl });
  const redis = new Redis(config.redis.url, { maxRetriesPerRequest: null, lazyConnect: false });

  const container = buildContainer({ config, logger, prisma, redis });
  if (options.googleOAuth) container.googleOAuth = options.googleOAuth;
  const app = await buildApp({ container });

  const ingest = async (organizationId: string, documentId: string): Promise<number> => {
    const doc = await prisma.document.findFirstOrThrow({
      where: { id: documentId, organizationId },
    });
    if (!doc.sourceUri) throw new Error(`Document ${documentId} is missing a source object`);

    const text = (await container.storage.get(organizationId, doc.sourceUri)).toString('utf8');
    const chunks = chunkText(text);
    await prisma.documentChunk.deleteMany({ where: { documentId, organizationId } });

    const embed = await container.ai.embed({
      texts: chunks.map((c) => c.content),
      model: config.ai.embeddingModel,
      dimensions: config.ai.embeddingDimensions,
    });

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      await prisma.$executeRawUnsafe(
        `INSERT INTO document_chunks
           (id, organization_id, document_id, chunk_index, content, token_count, embedding, embedding_model, embedding_version, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8, 1, '{}'::jsonb, NOW())`,
        newId(IdPrefix.chunk),
        organizationId,
        documentId,
        chunk.index,
        chunk.content,
        chunk.tokenCount,
        toVectorLiteral(embed.embeddings[i]!),
        embed.model,
      );
    }

    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'INDEXED', indexedAt: new Date(), error: null },
    });
    return chunks.length;
  };

  const reset = async (): Promise<void> => {
    // Truncate all domain tables; CASCADE handles FK order. Restart identity is
    // unnecessary since ids are app-generated.
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "tool_invocations", "budget_periods", "subscriptions", "scim_tokens",
        "sso_connections", "stored_objects", "prompt_templates",
        "collection_documents", "collections", "team_memberships", "teams",
        "document_acls", "document_versions",
        "idempotency_keys", "message_feedback", "webhook_deliveries", "webhook_endpoints",
        "audit_logs", "usage_events", "evaluation_results", "evaluations",
        "ingestion_jobs", "citations", "messages", "conversations",
        "document_chunks", "documents", "data_sources", "invites",
        "api_keys", "sessions", "memberships", "users", "organizations"
      RESTART IDENTITY CASCADE;
    `);
    await redis.flushdb();
  };

  const close = async (): Promise<void> => {
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
  };

  return { app, container, prisma, redis, ingest, reset, close };
}
