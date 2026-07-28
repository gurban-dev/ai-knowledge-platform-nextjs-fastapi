import { chunkText, createAiRegistry, type AiProvider } from '@akp/ai';
import { IdPrefix, newId, redactPii } from '@akp/core';
import { toVectorLiteral, type PrismaClient } from '@akp/db';
import type { ObjectStorage } from '@akp/storage';
import type { Logger } from '@akp/observability';

export interface IngestDocumentJob {
  organizationId: string;
  documentId: string;
  jobId: string;
}

/**
 * Full document ingestion: load bytes → optional PII redact → chunk → embed →
 * write pgvector rows → mark INDEXED. Shared by the worker and tests.
 */
export async function ingestDocument(
  deps: {
    prisma: PrismaClient;
    storage: ObjectStorage;
    ai: AiProvider;
    logger: Logger;
    embeddingModel: string;
    embeddingDimensions: number;
    piiRedactionEnabled: boolean;
  },
  job: IngestDocumentJob,
): Promise<{ chunkCount: number; costMicros: number }> {
  const document = await deps.prisma.document.findFirst({
    where: { id: job.documentId, organizationId: job.organizationId },
  });
  if (!document?.sourceUri) {
    throw new Error(`Document ${job.documentId} not found or missing source`);
  }

  await deps.prisma.document.update({
    where: { id: document.id },
    data: { status: 'PROCESSING', error: null },
  });
  await deps.prisma.ingestionJob.update({
    where: { id: job.jobId },
    data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
  });

  try {
    let text = (await deps.storage.get(job.organizationId, document.sourceUri)).toString('utf8');
    if (deps.piiRedactionEnabled) {
      text = redactPii(text).redacted;
    }

    const chunks = chunkText(text);
    await deps.prisma.documentChunk.deleteMany({
      where: { documentId: document.id, organizationId: job.organizationId },
    });

    let totalCost = 0;
    const batchSize = 32;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const embed = await deps.ai.embed({
        texts: batch.map((c) => c.content),
        model: deps.embeddingModel,
        dimensions: deps.embeddingDimensions,
      });
      totalCost += embed.costMicros;

      for (let j = 0; j < batch.length; j++) {
        const chunk = batch[j]!;
        const chunkId = newId(IdPrefix.chunk);
        const vector = toVectorLiteral(embed.embeddings[j]!);
        await deps.prisma.$executeRawUnsafe(
          `INSERT INTO document_chunks
             (id, organization_id, document_id, chunk_index, content, token_count, embedding, embedding_model, embedding_version, metadata, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8, 1, '{}'::jsonb, NOW())`,
          chunkId,
          job.organizationId,
          document.id,
          chunk.index,
          chunk.content,
          chunk.tokenCount,
          vector,
          embed.model,
        );
      }

      await deps.prisma.usageEvent.create({
        data: {
          id: newId(IdPrefix.usageEvent),
          organizationId: job.organizationId,
          kind: 'EMBEDDING',
          model: embed.model,
          promptTokens: embed.promptTokens,
          completionTokens: 0,
          totalTokens: BigInt(embed.promptTokens),
          costMicros: BigInt(embed.costMicros),
          latencyMs: embed.latencyMs,
          metadata: { documentId: document.id, batchStart: i },
        },
      });
    }

    await deps.prisma.document.update({
      where: { id: document.id },
      data: { status: 'INDEXED', indexedAt: new Date(), error: null },
    });
    await deps.prisma.ingestionJob.update({
      where: { id: job.jobId },
      data: { status: 'COMPLETED', finishedAt: new Date(), error: null },
    });

    deps.logger.info(
      { documentId: document.id, chunkCount: chunks.length, costMicros: totalCost },
      'Document ingested',
    );
    return { chunkCount: chunks.length, costMicros: totalCost };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.prisma.document.update({
      where: { id: document.id },
      data: { status: 'FAILED', error: message },
    });
    await deps.prisma.ingestionJob.update({
      where: { id: job.jobId },
      data: { status: 'FAILED', finishedAt: new Date(), error: message },
    });
    throw error;
  }
}

export function createWorkerAi(forceFake: boolean, openaiApiKey?: string, anthropicApiKey?: string) {
  return createAiRegistry({ forceFake, openaiApiKey, anthropicApiKey });
}
