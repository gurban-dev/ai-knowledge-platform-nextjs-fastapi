import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Role } from '@akp/core';
import { commonErrorResponses, paginationQuerySchema } from '../../lib/http.js';
import type { RequestMeta } from '../auth/auth.types.js';

function requestMeta(request: FastifyRequest): RequestMeta {
  return { ipAddress: request.ip, userAgent: request.headers['user-agent'] };
}

const evaluationSampleSchema = z.object({
  question: z.string().min(1),
  expected: z.string().optional().nullable(),
  answer: z.string(),
  scores: z.record(z.string(), z.number()),
  hallucinated: z.boolean().optional(),
});

const summarySchema = z.object({
  sampleCount: z.number(),
  averageFaithfulness: z.number(),
  averageAnswerRelevance: z.number(),
  averageContextPrecision: z.number(),
  averageContextRecall: z.number(),
  hallucinationRate: z.number(),
});

const runSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  summary: summarySchema,
  sampleCount: z.number().int(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});

export const evaluationRoutes: FastifyPluginAsync = async (app) => {
  const fastify = app.withTypeProvider<ZodTypeProvider>();
  const { evaluations } = fastify.container.services;

  // Stateless quality computation (backward compatible).
  fastify.post(
    '/v1/evaluations/quality',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['evaluations'],
        summary: 'Compute retrieval and answer quality metrics (stateless)',
        security: [{ bearerAuth: [] }],
        body: z.object({ samples: z.array(evaluationSampleSchema) }),
        response: { 200: summarySchema, ...commonErrorResponses },
      },
    },
    async (request) => evaluations.buildSummary(request.body.samples),
  );

  // Persist a named evaluation run.
  fastify.post(
    '/v1/evaluations',
    {
      onRequest: [fastify.authenticate, fastify.requireRole(Role.MEMBER)],
      schema: {
        tags: ['evaluations'],
        summary: 'Create and persist an evaluation run',
        security: [{ bearerAuth: [] }],
        body: z.object({
          name: z.string().min(1).max(120),
          samples: z.array(evaluationSampleSchema).min(1).max(1000),
        }),
        response: { 201: runSchema, ...commonErrorResponses },
      },
    },
    async (request, reply) => {
      const run = await evaluations.createRun({
        organizationId: request.auth!.organizationId,
        name: request.body.name,
        samples: request.body.samples,
        actorUserId: request.auth!.userId,
        meta: requestMeta(request),
      });
      void reply.status(201);
      return run;
    },
  );

  fastify.get(
    '/v1/evaluations',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['evaluations'],
        summary: 'List evaluation runs',
        security: [{ bearerAuth: [] }],
        querystring: paginationQuerySchema,
        response: {
          200: z.object({ evaluations: z.array(runSchema), nextCursor: z.string().nullable() }),
          ...commonErrorResponses,
        },
      },
    },
    async (request) =>
      evaluations.list(request.auth!.organizationId, {
        limit: request.query.limit,
        cursor: request.query.cursor,
      }),
  );

  fastify.get(
    '/v1/evaluations/:id',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['evaluations'],
        summary: 'Get an evaluation run with its per-sample results',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string() }),
        response: {
          200: runSchema.extend({
            results: z.array(
              z.object({
                question: z.string(),
                expected: z.string().nullable(),
                answer: z.string(),
                scores: z.record(z.string(), z.number()),
                hallucinated: z.boolean(),
              }),
            ),
          }),
          ...commonErrorResponses,
        },
      },
    },
    async (request) => evaluations.get(request.params.id, request.auth!.organizationId),
  );
};
