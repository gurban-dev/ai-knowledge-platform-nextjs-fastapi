import { IdPrefix, newId, NotFoundError } from '@akp/core';
import type { Prisma } from '@akp/db';
import type { Logger } from '@akp/observability';
import { AuditAction, type AuditService } from '../audit/audit.service.js';
import type { RequestMeta } from '../auth/auth.types.js';
import type { EvaluationRepository } from './evaluation.repository.js';

export interface EvaluationSample {
  question: string;
  expected?: string | null | undefined;
  answer: string;
  scores: Record<string, number>;
  hallucinated?: boolean | undefined;
}

export interface EvaluationSummary {
  sampleCount: number;
  averageFaithfulness: number;
  averageAnswerRelevance: number;
  averageContextPrecision: number;
  averageContextRecall: number;
  hallucinationRate: number;
}

export interface EvaluationRunDto {
  id: string;
  name: string;
  status: string;
  summary: EvaluationSummary;
  sampleCount: number;
  createdAt: string;
  finishedAt: string | null;
}

export interface EvaluationResultDto {
  question: string;
  expected: string | null;
  answer: string;
  scores: Record<string, number>;
  hallucinated: boolean;
}

export interface EvaluationServiceDeps {
  repository: EvaluationRepository;
  audit: AuditService;
  logger: Logger;
}

/**
 * Retrieval/answer-quality evaluation. `buildSummary` is a pure aggregation used
 * both by the stateless quality endpoint and when persisting a named run, so
 * scoring stays identical across ad-hoc checks and stored evaluations.
 */
export class EvaluationService {
  constructor(private readonly deps: EvaluationServiceDeps) {}

  buildSummary(samples: EvaluationSample[]): EvaluationSummary {
    if (samples.length === 0) {
      return {
        sampleCount: 0,
        averageFaithfulness: 0,
        averageAnswerRelevance: 0,
        averageContextPrecision: 0,
        averageContextRecall: 0,
        hallucinationRate: 0,
      };
    }

    const average = (key: string): number => {
      const values = samples.map((sample) => sample.scores[key] ?? 0);
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    };

    return {
      sampleCount: samples.length,
      averageFaithfulness: Number(average('faithfulness').toFixed(4)),
      averageAnswerRelevance: Number(average('answerRelevance').toFixed(4)),
      averageContextPrecision: Number(average('contextPrecision').toFixed(4)),
      averageContextRecall: Number(average('contextRecall').toFixed(4)),
      hallucinationRate: Number(
        (samples.filter((sample) => sample.hallucinated).length / samples.length).toFixed(4),
      ),
    };
  }

  /** Compute a summary and persist the run with all its samples. */
  async createRun(input: {
    organizationId: string;
    name: string;
    samples: EvaluationSample[];
    actorUserId: string;
    meta: RequestMeta;
  }): Promise<EvaluationRunDto> {
    const summary = this.buildSummary(input.samples);
    const evaluationId = newId(IdPrefix.evaluation);
    const finishedAt = new Date();

    const evaluation = await this.deps.repository.createCompleted(
      {
        id: evaluationId,
        organizationId: input.organizationId,
        name: input.name,
        summary: summary as unknown as Prisma.InputJsonValue,
      },
      input.samples.map((sample) => ({
        id: newId(IdPrefix.evaluationResult),
        evaluationId,
        question: sample.question,
        expected: sample.expected ?? null,
        answer: sample.answer,
        scores: sample.scores,
        hallucinated: sample.hallucinated ?? false,
      })),
      finishedAt,
    );

    await this.deps.audit.record({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: AuditAction.EvaluationCreated,
      resourceType: 'evaluation',
      resourceId: evaluationId,
      metadata: { sampleCount: summary.sampleCount },
      ...input.meta,
    });
    this.deps.logger.info(
      { organizationId: input.organizationId, evaluationId, samples: summary.sampleCount },
      'Evaluation run persisted',
    );

    return {
      id: evaluation.id,
      name: evaluation.name,
      status: evaluation.status,
      summary,
      sampleCount: summary.sampleCount,
      createdAt: evaluation.createdAt.toISOString(),
      finishedAt: evaluation.finishedAt?.toISOString() ?? null,
    };
  }

  async list(
    organizationId: string,
    pagination: { limit: number; cursor?: string | undefined },
  ): Promise<{ evaluations: EvaluationRunDto[]; nextCursor: string | null }> {
    const rows = await this.deps.repository.listByOrganization(
      organizationId,
      pagination.limit + 1,
      pagination.cursor,
    );
    const hasMore = rows.length > pagination.limit;
    const page = hasMore ? rows.slice(0, pagination.limit) : rows;
    return {
      evaluations: page.map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        summary: (row.summary as unknown as EvaluationSummary) ?? this.buildSummary([]),
        sampleCount: row._count.results,
        createdAt: row.createdAt.toISOString(),
        finishedAt: row.finishedAt?.toISOString() ?? null,
      })),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  async get(
    id: string,
    organizationId: string,
  ): Promise<EvaluationRunDto & { results: EvaluationResultDto[] }> {
    const evaluation = await this.deps.repository.findById(id, organizationId);
    if (!evaluation) {
      throw new NotFoundError('Evaluation');
    }
    const results = await this.deps.repository.listResults(id);
    const summary = (evaluation.summary as unknown as EvaluationSummary) ?? this.buildSummary([]);
    return {
      id: evaluation.id,
      name: evaluation.name,
      status: evaluation.status,
      summary,
      sampleCount: results.length,
      createdAt: evaluation.createdAt.toISOString(),
      finishedAt: evaluation.finishedAt?.toISOString() ?? null,
      results: results.map((r) => ({
        question: r.question,
        expected: r.expected,
        answer: r.answer,
        scores: (r.scores as unknown as Record<string, number>) ?? {},
        hallucinated: r.hallucinated,
      })),
    };
  }
}
