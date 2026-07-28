import {
  BudgetExceededError,
  IdPrefix,
  newId,
  NotFoundError,
  QuotaExceededError,
} from '@akp/core';
import type { PrismaClient, Subscription } from '@akp/db';
import type { OrganizationService } from '../organizations/organization.service.js';
import type { AuditService } from '../audit/audit.service.js';
import { AuditAction } from '../audit/audit.service.js';

const PLAN_DEFAULTS: Record<
  string,
  {
    maxDocuments: number;
    maxMembers: number;
    maxApiKeys: number;
    monthlyBudgetMicros: bigint | null;
  }
> = {
  free: {
    maxDocuments: 50,
    maxMembers: 5,
    maxApiKeys: 2,
    monthlyBudgetMicros: 5_000_000n,
  },
  starter: {
    maxDocuments: 1000,
    maxMembers: 25,
    maxApiKeys: 10,
    monthlyBudgetMicros: 50_000_000n,
  },
  business: {
    maxDocuments: 25_000,
    maxMembers: 200,
    maxApiKeys: 50,
    monthlyBudgetMicros: 500_000_000n,
  },
  enterprise: {
    maxDocuments: 0,
    maxMembers: 0,
    maxApiKeys: 0,
    monthlyBudgetMicros: null,
  },
};

function periodKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export class BillingService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly organizations: OrganizationService,
    private readonly audit: AuditService,
  ) {}

  async ensureSubscription(organizationId: string): Promise<Subscription> {
    const existing = await this.prisma.subscription.findUnique({ where: { organizationId } });
    if (existing) return existing;
    const now = new Date();
    const end = new Date(now);
    end.setUTCMonth(end.getUTCMonth() + 1);
    const defaults = PLAN_DEFAULTS.starter!;
    return this.prisma.subscription.create({
      data: {
        id: newId(IdPrefix.subscription),
        organizationId,
        plan: 'starter',
        status: 'TRIALING',
        maxDocuments: defaults.maxDocuments,
        maxMembers: defaults.maxMembers,
        maxApiKeys: defaults.maxApiKeys,
        monthlyBudgetMicros: defaults.monthlyBudgetMicros,
        currentPeriodStart: now,
        currentPeriodEnd: end,
      },
    });
  }

  async getSubscription(organizationId: string): Promise<Subscription> {
    return this.ensureSubscription(organizationId);
  }

  async checkDocumentQuota(organizationId: string): Promise<void> {
    const sub = await this.ensureSubscription(organizationId);
    if (sub.maxDocuments === 0) return;
    const count = await this.prisma.document.count({
      where: { organizationId, deletedAt: null },
    });
    if (count >= sub.maxDocuments) {
      throw new QuotaExceededError('Document quota exceeded for the current plan', {
        maxDocuments: sub.maxDocuments,
        current: count,
      });
    }
  }

  async checkMemberQuota(organizationId: string): Promise<void> {
    const sub = await this.ensureSubscription(organizationId);
    if (sub.maxMembers === 0) return;
    const count = await this.prisma.membership.count({
      where: { organizationId, status: 'ACTIVE' },
    });
    if (count >= sub.maxMembers) {
      throw new QuotaExceededError('Member quota exceeded for the current plan', {
        maxMembers: sub.maxMembers,
        current: count,
      });
    }
  }

  async checkApiKeyQuota(organizationId: string): Promise<void> {
    const sub = await this.ensureSubscription(organizationId);
    if (sub.maxApiKeys === 0) return;
    const count = await this.prisma.apiKey.count({
      where: { organizationId, status: 'ACTIVE' },
    });
    if (count >= sub.maxApiKeys) {
      throw new QuotaExceededError('API key quota exceeded for the current plan', {
        maxApiKeys: sub.maxApiKeys,
        current: count,
      });
    }
  }

  async assertWithinBudget(organizationId: string, additionalMicros: number): Promise<void> {
    const settings = await this.organizations.getSettings(organizationId);
    const sub = await this.ensureSubscription(organizationId);
    const budget =
      settings.monthlySpendCapMicros != null
        ? BigInt(settings.monthlySpendCapMicros)
        : sub.monthlyBudgetMicros;
    if (budget == null) return;

    const period = periodKey();
    const row = await this.prisma.budgetPeriod.upsert({
      where: { organizationId_period: { organizationId, period } },
      create: {
        id: newId(IdPrefix.budgetPeriod),
        organizationId,
        period,
        spentMicros: 0n,
        budgetMicros: budget,
      },
      update: { budgetMicros: budget },
    });

    if (row.hardStoppedAt || row.spentMicros + BigInt(additionalMicros) > budget) {
      if (!row.hardStoppedAt) {
        await this.prisma.budgetPeriod.update({
          where: { id: row.id },
          data: { hardStoppedAt: new Date() },
        });
      }
      throw new BudgetExceededError('Monthly AI spend cap exceeded', {
        budgetMicros: budget.toString(),
        spentMicros: row.spentMicros.toString(),
      });
    }
  }

  async recordSpend(organizationId: string, costMicros: number): Promise<void> {
    if (costMicros <= 0) return;
    const period = periodKey();
    const sub = await this.ensureSubscription(organizationId);
    await this.prisma.budgetPeriod.upsert({
      where: { organizationId_period: { organizationId, period } },
      create: {
        id: newId(IdPrefix.budgetPeriod),
        organizationId,
        period,
        spentMicros: BigInt(costMicros),
        budgetMicros: sub.monthlyBudgetMicros,
      },
      update: { spentMicros: { increment: BigInt(costMicros) } },
    });
  }

  async updatePlan(
    organizationId: string,
    plan: string,
    actorUserId: string,
  ): Promise<Subscription> {
    const defaults = PLAN_DEFAULTS[plan];
    if (!defaults) throw new NotFoundError('Plan');
    await this.ensureSubscription(organizationId);
    const updated = await this.prisma.subscription.update({
      where: { organizationId },
      data: {
        plan,
        status: 'ACTIVE',
        maxDocuments: defaults.maxDocuments,
        maxMembers: defaults.maxMembers,
        maxApiKeys: defaults.maxApiKeys,
        monthlyBudgetMicros: defaults.monthlyBudgetMicros,
      },
    });
    await this.audit.record({
      organizationId,
      actorUserId,
      action: AuditAction.SubscriptionUpdated,
      resourceType: 'subscription',
      resourceId: updated.id,
      metadata: { plan },
    });
    return updated;
  }

  async getBudget(organizationId: string) {
    const sub = await this.ensureSubscription(organizationId);
    const period = periodKey();
    const row = await this.prisma.budgetPeriod.findUnique({
      where: { organizationId_period: { organizationId, period } },
    });
    return {
      period,
      plan: sub.plan,
      budgetMicros: (row?.budgetMicros ?? sub.monthlyBudgetMicros)?.toString() ?? null,
      spentMicros: (row?.spentMicros ?? 0n).toString(),
      hardStopped: Boolean(row?.hardStoppedAt),
    };
  }
}
