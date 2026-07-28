import { IdPrefix, newId } from '@akp/core';
import type { Prisma, UsageKind } from '@akp/db';
import type { UsageRepository } from './usage.repository.js';
import type { BillingService } from '../billing/billing.service.js';

export interface RecordUsageInput {
  organizationId: string;
  userId?: string | null;
  kind: UsageKind;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costMicros: number;
  latencyMs: number;
  metadata?: Prisma.InputJsonValue;
}

export class UsageService {
  constructor(
    private readonly repository: UsageRepository,
    private readonly billing: BillingService,
  ) {}

  async record(input: RecordUsageInput) {
    await this.billing.assertWithinBudget(input.organizationId, input.costMicros);
    const event = await this.repository.create({
      id: newId(IdPrefix.usageEvent),
      organizationId: input.organizationId,
      userId: input.userId ?? null,
      kind: input.kind,
      model: input.model,
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      totalTokens: BigInt(input.promptTokens + input.completionTokens),
      costMicros: BigInt(input.costMicros),
      latencyMs: input.latencyMs,
      metadata: input.metadata ?? {},
    });
    await this.billing.recordSpend(input.organizationId, input.costMicros);
    return event;
  }

  async summary(organizationId: string, since: Date) {
    const spent = await this.repository.sumCostMicrosSince(organizationId, since);
    const breakdown = await this.repository.breakdownSince(organizationId, since);
    return {
      spentMicros: spent.toString(),
      breakdown: breakdown.map((row) => ({
        kind: row.kind,
        model: row.model,
        costMicros: row.costMicros.toString(),
        totalTokens: row.totalTokens.toString(),
        events: row.events,
      })),
    };
  }
}
