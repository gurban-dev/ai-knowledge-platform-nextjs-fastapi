import {
  reciprocalRankFusion,
  type AiProvider,
} from '@akp/ai';
import { toVectorLiteral } from '@akp/db';
import type { PrismaClient, Role } from '@akp/db';
import type { AppConfig } from '../../config.js';
import type { DocumentRepository } from '../documents/document.repository.js';
import {
  filterAccessibleDocumentIds,
  type AclPrincipal,
} from '../documents/document-acl.js';
import type { UsageService } from '../usage/usage.service.js';

export interface SearchHit {
  chunkId: string;
  documentId: string;
  content: string;
  score: number;
  title: string;
}

interface RawChunkRow {
  id: string;
  document_id: string;
  content: string;
  score: number;
  title: string;
}

export class SearchService {
  constructor(
    private readonly deps: {
      prisma: PrismaClient;
      documents: DocumentRepository;
      ai: AiProvider;
      usage: UsageService;
      config: AppConfig;
      resolveTeamIds: (organizationId: string, userId: string) => Promise<string[]>;
    },
  ) {}

  async search(params: {
    organizationId: string;
    userId: string;
    role: Role;
    query: string;
    limit?: number;
    collectionId?: string;
  }): Promise<SearchHit[]> {
    const { retrieval } = this.deps.config.ai;
    const limit = params.limit ?? retrieval.rerankK;
    const teamIds = await this.deps.resolveTeamIds(params.organizationId, params.userId);
    const principal: AclPrincipal = {
      userId: params.userId,
      role: params.role,
      teamIds,
    };

    const embed = await this.deps.ai.embed({
      texts: [params.query],
      model: this.deps.config.ai.embeddingModel,
      dimensions: this.deps.config.ai.embeddingDimensions,
    });
    await this.deps.usage.record({
      organizationId: params.organizationId,
      userId: params.userId,
      kind: 'EMBEDDING',
      model: embed.model,
      promptTokens: embed.promptTokens,
      completionTokens: 0,
      costMicros: embed.costMicros,
      latencyMs: embed.latencyMs,
    });

    const vectorLiteral = toVectorLiteral(embed.embeddings[0]!);
    const collectionFilter = params.collectionId
      ? `AND d.id IN (SELECT document_id FROM collection_documents WHERE collection_id = '${params.collectionId.replace(/'/g, '')}')`
      : '';

    const vectorRows = await this.deps.prisma.$queryRawUnsafe<RawChunkRow[]>(
      `SELECT c.id, c.document_id, c.content,
              (1 - (c.embedding <=> $1::vector))::float8 AS score,
              d.title AS title
       FROM document_chunks c
       JOIN documents d ON d.id = c.document_id
       WHERE c.organization_id = $2
         AND c.embedding IS NOT NULL
         AND d.deleted_at IS NULL
         ${collectionFilter}
       ORDER BY c.embedding <=> $1::vector
       LIMIT $3`,
      vectorLiteral,
      params.organizationId,
      retrieval.vectorK,
    );

    const lexicalRows = await this.deps.prisma.$queryRawUnsafe<RawChunkRow[]>(
      `SELECT c.id, c.document_id, c.content,
              similarity(c.content, $1)::float8 AS score,
              d.title AS title
       FROM document_chunks c
       JOIN documents d ON d.id = c.document_id
       WHERE c.organization_id = $2
         AND d.deleted_at IS NULL
         AND c.content % $1
         ${collectionFilter}
       ORDER BY similarity(c.content, $1) DESC
       LIMIT $3`,
      params.query,
      params.organizationId,
      retrieval.lexicalK,
    );

    const fused = reciprocalRankFusion(
      vectorRows.map((r, i) => ({ id: r.id, rank: i + 1, score: r.score })),
      lexicalRows.map((r, i) => ({ id: r.id, rank: i + 1, score: r.score })),
      Math.max(retrieval.rerankK * 3, limit * 3),
    );

    const byId = new Map<string, RawChunkRow>();
    for (const row of [...vectorRows, ...lexicalRows]) byId.set(row.id, row);

    const candidateDocIds = [
      ...new Set(fused.map((h) => byId.get(h.id)?.document_id).filter(Boolean) as string[]),
    ];
    const acls = await this.deps.documents.getAclsForDocuments(candidateDocIds);
    const aclsByDoc = new Map<string, typeof acls>();
    for (const acl of acls) {
      const list = aclsByDoc.get(acl.documentId) ?? [];
      list.push(acl);
      aclsByDoc.set(acl.documentId, list);
    }
    const allowedDocs = new Set(
      filterAccessibleDocumentIds(candidateDocIds, aclsByDoc, principal),
    );

    const allowedChunks = fused
      .map((h) => byId.get(h.id))
      .filter((row): row is RawChunkRow => !!row && allowedDocs.has(row.document_id));

    if (allowedChunks.length === 0) return [];

    const rerank = await this.deps.ai.rerank({
      query: params.query,
      documents: allowedChunks.map((c) => c.content),
      topN: limit,
    });
    await this.deps.usage.record({
      organizationId: params.organizationId,
      userId: params.userId,
      kind: 'RERANK',
      model: rerank.model,
      promptTokens: 0,
      completionTokens: 0,
      costMicros: rerank.costMicros,
      latencyMs: rerank.latencyMs,
    });

    return rerank.hits
      .map((hit) => {
        const row = allowedChunks[hit.index]!;
        return {
          chunkId: row.id,
          documentId: row.document_id,
          content: row.content,
          score: hit.score,
          title: row.title,
        };
      })
      .filter((h) => h.score >= retrieval.minScore);
  }
}
