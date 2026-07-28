import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Role } from '@akp/core';
import { commonErrorResponses, paginationQuerySchema } from '../../lib/http.js';
import {
  createDocumentBodySchema,
  documentListSchema,
  documentSchema,
  replaceAclsBodySchema,
} from './document.schemas.js';

function toDto(doc: {
  id: string;
  title: string;
  mimeType: string;
  status: string;
  byteSize: bigint;
  contentHash: string;
  sourceUri: string | null;
  dataSourceId: string | null;
  chunkingStrategy: string;
  indexedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: doc.id,
    title: doc.title,
    mimeType: doc.mimeType,
    status: doc.status,
    byteSize: doc.byteSize.toString(),
    contentHash: doc.contentHash,
    sourceUri: doc.sourceUri,
    dataSourceId: doc.dataSourceId,
    chunkingStrategy: doc.chunkingStrategy,
    indexedAt: doc.indexedAt?.toISOString() ?? null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export const documentRoutes: FastifyPluginAsync = async (app) => {
  const fastify = app.withTypeProvider<ZodTypeProvider>();

  fastify.post(
    '/v1/documents',
    {
      onRequest: [fastify.authenticate, fastify.requireRole(Role.MEMBER)],
      schema: {
        tags: ['documents'],
        summary: 'Upload a text document for ingestion',
        body: createDocumentBodySchema,
        response: { 201: documentSchema, ...commonErrorResponses },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const teamIds = await fastify.container.resolveTeamIds(auth.organizationId, auth.userId);
      void teamIds;
      const doc = await fastify.container.services.documents.create({
        organizationId: auth.organizationId,
        userId: auth.userId,
        role: auth.role,
        title: request.body.title,
        content: request.body.content,
        mimeType: request.body.mimeType,
        dataSourceId: request.body.dataSourceId,
        metadata: request.body.metadata,
      });
      return reply.status(201).send(toDto(doc));
    },
  );

  fastify.get(
    '/v1/documents',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['documents'],
        summary: 'List documents visible to the caller',
        querystring: paginationQuerySchema,
        response: { 200: documentListSchema, ...commonErrorResponses },
      },
    },
    async (request) => {
      const auth = request.auth!;
      const teamIds = await fastify.container.resolveTeamIds(auth.organizationId, auth.userId);
      const result = await fastify.container.services.documents.list(
        auth.organizationId,
        { userId: auth.userId, role: auth.role, teamIds },
        request.query.limit,
        request.query.cursor,
      );
      return {
        documents: result.documents.map(toDto),
        nextCursor: result.nextCursor,
      };
    },
  );

  fastify.get(
    '/v1/documents/:id',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['documents'],
        params: z.object({ id: z.string() }),
        response: { 200: documentSchema, ...commonErrorResponses },
      },
    },
    async (request) => {
      const auth = request.auth!;
      const teamIds = await fastify.container.resolveTeamIds(auth.organizationId, auth.userId);
      const doc = await fastify.container.services.documents.get(auth.organizationId, request.params.id, {
        userId: auth.userId,
        role: auth.role,
        teamIds,
      });
      return toDto(doc);
    },
  );

  fastify.delete(
    '/v1/documents/:id',
    {
      onRequest: [fastify.authenticate, fastify.requireRole(Role.ADMIN)],
      schema: {
        tags: ['documents'],
        params: z.object({ id: z.string() }),
        response: { 204: z.null(), ...commonErrorResponses },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const teamIds = await fastify.container.resolveTeamIds(auth.organizationId, auth.userId);
      await fastify.container.services.documents.softDelete(auth.organizationId, request.params.id, {
        userId: auth.userId,
        role: auth.role,
        teamIds,
      });
      return reply.status(204).send(null);
    },
  );

  fastify.put(
    '/v1/documents/:id/acls',
    {
      onRequest: [fastify.authenticate, fastify.requireRole(Role.ADMIN)],
      schema: {
        tags: ['documents'],
        params: z.object({ id: z.string() }),
        body: replaceAclsBodySchema,
        response: {
          200: z.object({
            entries: z.array(
              z.object({
                id: z.string(),
                subjectType: z.string(),
                subjectId: z.string(),
                permission: z.string(),
              }),
            ),
          }),
          ...commonErrorResponses,
        },
      },
    },
    async (request) => {
      const auth = request.auth!;
      const teamIds = await fastify.container.resolveTeamIds(auth.organizationId, auth.userId);
      const entries = await fastify.container.services.documents.replaceAcls(
        auth.organizationId,
        request.params.id,
        { userId: auth.userId, role: auth.role, teamIds },
        request.body.entries,
      );
      return {
        entries: entries.map((e) => ({
          id: e.id,
          subjectType: e.subjectType,
          subjectId: e.subjectId,
          permission: e.permission,
        })),
      };
    },
  );
};
