import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Role } from '@akp/core';
import { commonErrorResponses } from '../../lib/http.js';

const subscriptionSchema = z.object({
  id: z.string(),
  plan: z.string(),
  status: z.string(),
  maxDocuments: z.number(),
  maxMembers: z.number(),
  maxApiKeys: z.number(),
  monthlyBudgetMicros: z.string().nullable(),
  currentPeriodStart: z.string(),
  currentPeriodEnd: z.string(),
});

export const billingRoutes: FastifyPluginAsync = async (app) => {
  const fastify = app.withTypeProvider<ZodTypeProvider>();

  fastify.get(
    '/v1/billing/subscription',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['billing'],
        summary: 'Get current subscription and entitlements',
        response: { 200: subscriptionSchema, ...commonErrorResponses },
      },
    },
    async (request) => {
      const sub = await fastify.container.services.billing.getSubscription(
        request.auth!.organizationId,
      );
      return {
        id: sub.id,
        plan: sub.plan,
        status: sub.status,
        maxDocuments: sub.maxDocuments,
        maxMembers: sub.maxMembers,
        maxApiKeys: sub.maxApiKeys,
        monthlyBudgetMicros: sub.monthlyBudgetMicros?.toString() ?? null,
        currentPeriodStart: sub.currentPeriodStart.toISOString(),
        currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
      };
    },
  );

  fastify.get(
    '/v1/billing/budget',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['billing'],
        summary: 'Get current-period AI spend vs budget',
        response: {
          200: z.object({
            period: z.string(),
            plan: z.string(),
            budgetMicros: z.string().nullable(),
            spentMicros: z.string(),
            hardStopped: z.boolean(),
          }),
          ...commonErrorResponses,
        },
      },
    },
    async (request) =>
      fastify.container.services.billing.getBudget(request.auth!.organizationId),
  );

  fastify.post(
    '/v1/billing/plan',
    {
      onRequest: [fastify.authenticate, fastify.requireRole(Role.OWNER)],
      schema: {
        tags: ['billing'],
        summary: 'Update organization plan',
        body: z.object({ plan: z.enum(['free', 'starter', 'business', 'enterprise']) }),
        response: { 200: subscriptionSchema, ...commonErrorResponses },
      },
    },
    async (request) => {
      const sub = await fastify.container.services.billing.updatePlan(
        request.auth!.organizationId,
        request.body.plan,
        request.auth!.userId,
      );
      return {
        id: sub.id,
        plan: sub.plan,
        status: sub.status,
        maxDocuments: sub.maxDocuments,
        maxMembers: sub.maxMembers,
        maxApiKeys: sub.maxApiKeys,
        monthlyBudgetMicros: sub.monthlyBudgetMicros?.toString() ?? null,
        currentPeriodStart: sub.currentPeriodStart.toISOString(),
        currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
      };
    },
  );
};
