import type { Prisma, UsageEvent, UsageKind } from '@akp/db';
import { BaseRepository } from '../../lib/repository.js';

export interface CreateUsageEventData {
  id: string;
  organizationId: string;
  userId?: string | null;
  kind: UsageKind;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: bigint;
  costMicros: bigint;
  latencyMs: number;
  metadata?: Prisma.InputJsonValue;
}

export interface UsageBreakdownRow {
  kind: UsageKind;
  model: string;
  costMicros: bigint;
  totalTokens: bigint;
  events: number;
}

/** Persistence + aggregation for AI usage/cost accounting (micro-USD integers). */
export class UsageRepository extends BaseRepository<UsageRepository> {
  async create(data: CreateUsageEventData): Promise<UsageEvent> {
    return this.db.usageEvent.create({
      data: {
        id: data.id,
        organizationId: data.organizationId,
        userId: data.userId ?? null,
        kind: data.kind,
        model: data.model,
        promptTokens: data.promptTokens,
        completionTokens: data.completionTokens,
        totalTokens: data.totalTokens,
        costMicros: data.costMicros,
        latencyMs: data.latencyMs,
        metadata: data.metadata ?? {},
      },
    });
  }

  /** Sum spend (micro-USD) for a tenant since a point in time (billing window). */
  async sumCostMicrosSince(organizationId: string, since: Date): Promise<bigint> {
    const result = await this.db.usageEvent.aggregate({
      where: { organizationId, createdAt: { gte: since } },
      _sum: { costMicros: true },
    });
    return result._sum.costMicros ?? 0n;
  }

  /** Per-(kind, model) rollup for a tenant since a point in time. */
  async breakdownSince(organizationId: string, since: Date): Promise<UsageBreakdownRow[]> {
    const rows = await this.db.usageEvent.groupBy({
      by: ['kind', 'model'],
      where: { organizationId, createdAt: { gte: since } },
      _sum: { costMicros: true, totalTokens: true },
      _count: { _all: true },
    });
    return rows.map((row) => ({
      kind: row.kind,
      model: row.model,
      costMicros: row._sum.costMicros ?? 0n,
      totalTokens: row._sum.totalTokens ?? 0n,
      events: row._count._all,
    }));
  }

  async listByOrganization(
    organizationId: string,
    take: number,
    cursorId?: string,
  ): Promise<UsageEvent[]> {
    return this.db.usageEvent.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
    });
  }
}
