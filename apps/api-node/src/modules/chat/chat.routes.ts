import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { commonErrorResponses } from '../../lib/http.js';

const conversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const answerSchema = z.object({
  conversationId: z.string(),
  userMessageId: z.string(),
  assistantMessageId: z.string(),
  content: z.string(),
  citations: z.array(
    z.object({
      documentId: z.string(),
      chunkId: z.string(),
      score: z.number(),
      snippet: z.string(),
      title: z.string(),
      index: z.number(),
    }),
  ),
  abstained: z.boolean(),
  model: z.string(),
  promptVersion: z.string(),
  latencyMs: z.number(),
  groundingConfidence: z.number(),
});

export const chatRoutes: FastifyPluginAsync = async (app) => {
  const fastify = app.withTypeProvider<ZodTypeProvider>();

  fastify.post(
    '/v1/conversations',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['chat'],
        body: z.object({
          title: z.string().max(200).optional(),
          collectionIds: z.array(z.string()).optional(),
        }),
        response: { 201: conversationSchema, ...commonErrorResponses },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const c = await fastify.container.services.chat.createConversation({
        organizationId: auth.organizationId,
        userId: auth.userId,
        ...(request.body.title !== undefined ? { title: request.body.title } : {}),
        ...(request.body.collectionIds !== undefined
          ? { collectionIds: request.body.collectionIds }
          : {}),
      });
      return reply.status(201).send({
        id: c.id,
        title: c.title,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      });
    },
  );

  fastify.get(
    '/v1/conversations',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['chat'],
        response: {
          200: z.object({ conversations: z.array(conversationSchema) }),
          ...commonErrorResponses,
        },
      },
    },
    async (request) => {
      const auth = request.auth!;
      const rows = await fastify.container.services.chat.listConversations(
        auth.organizationId,
        auth.userId,
      );
      return {
        conversations: rows.map((c) => ({
          id: c.id,
          title: c.title,
          createdAt: c.createdAt.toISOString(),
          updatedAt: c.updatedAt.toISOString(),
        })),
      };
    },
  );

  fastify.post(
    '/v1/conversations/:id/messages',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['chat'],
        summary: 'Ask a question (JSON response; SSE when Accept: text/event-stream)',
        params: z.object({ id: z.string() }),
        body: z.object({ question: z.string().min(1).max(8000) }),
        response: { 200: answerSchema, ...commonErrorResponses },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const answer = await fastify.container.services.chat.ask({
        organizationId: auth.organizationId,
        userId: auth.userId,
        role: auth.role,
        conversationId: request.params.id,
        question: request.body.question,
      });

      const accept = request.headers.accept ?? '';
      if (accept.includes('text/event-stream')) {
        reply.raw.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        const write = (event: string, data: unknown) => {
          reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };
        // Stream tokens in small chunks for progressive UI updates.
        const chunkSize = 24;
        for (let i = 0; i < answer.content.length; i += chunkSize) {
          write('token', { text: answer.content.slice(i, i + chunkSize) });
        }
        for (const citation of answer.citations) {
          write('citation', citation);
        }
        write('done', {
          assistantMessageId: answer.assistantMessageId,
          abstained: answer.abstained,
          groundingConfidence: answer.groundingConfidence,
          latencyMs: answer.latencyMs,
          promptVersion: answer.promptVersion,
          model: answer.model,
        });
        reply.raw.end();
        return;
      }

      return answer;
    },
  );
};
