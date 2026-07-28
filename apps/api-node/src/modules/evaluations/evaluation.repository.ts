import type { Evaluation, EvaluationResult, Prisma, PrismaClient } from '@akp/db';
import { BaseRepository } from '../../lib/repository.js';

export interface CreateEvaluationData {
  id: string;
  organizationId: string;
  name: string;
  summary: Prisma.InputJsonValue;
}

export interface CreateEvaluationResultData {
  id: string;
  evaluationId: string;
  question: string;
  expected?: string | null;
  answer: string;
  scores: Prisma.InputJsonValue;
  hallucinated: boolean;
}

export type EvaluationWithCount = Evaluation & { _count: { results: number } };

/** Persistence for evaluation runs and their per-sample results. */
export class EvaluationRepository extends BaseRepository<EvaluationRepository> {
  /** Create a completed run and its results atomically. */
  async createCompleted(
    evaluation: CreateEvaluationData,
    results: CreateEvaluationResultData[],
    finishedAt: Date,
  ): Promise<Evaluation> {
    // The batch (create + createMany) is atomic. `$transaction` lives on the
    // root client; repositories in this path are never bound to an outer tx.
    const client = this.db as PrismaClient;
    const [created] = await client.$transaction([
      this.db.evaluation.create({
        data: {
          id: evaluation.id,
          organizationId: evaluation.organizationId,
          name: evaluation.name,
          status: 'COMPLETED',
          summary: evaluation.summary,
          finishedAt,
        },
      }),
      ...(results.length > 0
        ? [
            this.db.evaluationResult.createMany({
              data: results.map((r) => ({
                id: r.id,
                evaluationId: r.evaluationId,
                question: r.question,
                expected: r.expected ?? null,
                answer: r.answer,
                scores: r.scores,
                hallucinated: r.hallucinated,
              })),
            }),
          ]
        : []),
    ]);
    return created;
  }

  async findById(id: string, organizationId: string): Promise<Evaluation | null> {
    return this.db.evaluation.findFirst({ where: { id, organizationId } });
  }

  async listResults(evaluationId: string): Promise<EvaluationResult[]> {
    return this.db.evaluationResult.findMany({
      where: { evaluationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listByOrganization(
    organizationId: string,
    take: number,
    cursorId?: string,
  ): Promise<EvaluationWithCount[]> {
    return this.db.evaluation.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
      include: { _count: { select: { results: true } } },
    });
  }
}
