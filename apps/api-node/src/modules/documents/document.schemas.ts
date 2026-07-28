import { z } from 'zod';

export const documentSchema = z.object({
  id: z.string(),
  title: z.string(),
  mimeType: z.string(),
  status: z.string(),
  byteSize: z.string(),
  contentHash: z.string(),
  sourceUri: z.string().nullable(),
  dataSourceId: z.string().nullable(),
  chunkingStrategy: z.string(),
  indexedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createDocumentBodySchema = z.object({
  title: z.string().min(1).max(500),
  content: z.string().min(1).max(2_000_000),
  mimeType: z.string().default('text/plain'),
  dataSourceId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const aclEntrySchema = z.object({
  subjectType: z.enum(['USER', 'TEAM', 'ROLE']),
  subjectId: z.string().min(1),
  permission: z.enum(['READ', 'WRITE', 'ADMIN']).default('READ'),
});

export const replaceAclsBodySchema = z.object({
  entries: z.array(aclEntrySchema).max(100),
});

export const documentListSchema = z.object({
  documents: z.array(documentSchema),
  nextCursor: z.string().nullable(),
});
