import { createHash } from 'node:crypto';
import {
  ConflictError,
  ErrorCode,
  ForbiddenError,
  IdPrefix,
  newId,
  NotFoundError,
  Role,
  redactPii,
} from '@akp/core';
import type { ObjectStorage } from '@akp/storage';
import type { Document, PrismaClient } from '@akp/db';
import type { Logger } from '@akp/observability';
import type { Queue } from 'bullmq';
import type { QueueJobPayloads } from '../../lib/queues.js';
import { type QueueName } from '../../lib/queues.js';
import type { AuditService } from '../audit/audit.service.js';
import { AuditAction } from '../audit/audit.service.js';
import type { OrganizationService } from '../organizations/organization.service.js';
import type { BillingService } from '../billing/billing.service.js';
import { canAccessDocument, type AclPrincipal } from './document-acl.js';
import type { DocumentRepository } from './document.repository.js';

export interface CreateDocumentInput {
  organizationId: string;
  userId: string;
  role: Role;
  title: string;
  content: string;
  mimeType: string;
  dataSourceId?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export class DocumentService {
  constructor(
    private readonly deps: {
      prisma: PrismaClient;
      documents: DocumentRepository;
      storage: ObjectStorage;
      organizations: OrganizationService;
      billing: BillingService;
      audit: AuditService;
      ingestQueue: Queue<QueueJobPayloads[typeof QueueName.Ingest]>;
      logger: Logger;
    },
  ) {}

  async create(input: CreateDocumentInput): Promise<Document> {
    await this.deps.billing.checkDocumentQuota(input.organizationId);

    const settings = await this.deps.organizations.getSettings(input.organizationId);
    let content = input.content;
    if (settings.piiRedactionEnabled) {
      content = redactPii(content).redacted;
    }

    const contentHash = createHash('sha256').update(content).digest('hex');
    const existing = await this.deps.documents.findByContentHash(
      input.organizationId,
      contentHash,
    );
    if (existing) {
      throw new ConflictError(
        'Document with identical content already exists',
        ErrorCode.ALREADY_EXISTS,
        { documentId: existing.id },
      );
    }

    const documentId = newId(IdPrefix.document);
    const storageKey = `documents/${documentId}/content.txt`;
    const body = Buffer.from(content, 'utf8');
    await this.deps.storage.put({
      organizationId: input.organizationId,
      key: storageKey,
      body,
      mimeType: input.mimeType,
      contentHash,
    });

    const storedObjectId = newId(IdPrefix.storedObject);
    await this.deps.prisma.storedObject.create({
      data: {
        id: storedObjectId,
        organizationId: input.organizationId,
        storageKey,
        bucket: this.deps.storage.bucket,
        mimeType: input.mimeType,
        byteSize: BigInt(body.byteLength),
        contentHash,
        encrypted: true,
      },
    });

    const document = await this.deps.documents.create({
      id: documentId,
      organizationId: input.organizationId,
      dataSourceId: input.dataSourceId ?? null,
      title: input.title,
      sourceUri: storageKey,
      storedObjectId,
      mimeType: input.mimeType,
      contentHash,
      byteSize: BigInt(body.byteLength),
      metadata: {
        ...(input.metadata ?? {}),
        uploadedBy: input.userId,
      },
    });

    const jobId = newId(IdPrefix.ingestionJob);
    await this.deps.prisma.ingestionJob.create({
      data: {
        id: jobId,
        organizationId: input.organizationId,
        type: 'INGEST_DOCUMENT',
        status: 'QUEUED',
        payload: { documentId, storageKey },
      },
    });

    const queueJob = await this.deps.ingestQueue.add(
      'INGEST_DOCUMENT',
      {
        type: 'INGEST_DOCUMENT',
        organizationId: input.organizationId,
        documentId,
        jobId,
      },
      { jobId, removeOnComplete: 1000, removeOnFail: 5000, attempts: 5, backoff: { type: 'exponential', delay: 2000 } },
    );

    await this.deps.prisma.ingestionJob.update({
      where: { id: jobId },
      data: { queueJobId: String(queueJob.id) },
    });

    await this.deps.audit.record({
      organizationId: input.organizationId,
      actorUserId: input.userId,
      action: AuditAction.DocumentCreated,
      resourceType: 'document',
      resourceId: document.id,
    });

    return document;
  }

  async get(
    organizationId: string,
    documentId: string,
    principal: AclPrincipal,
  ): Promise<Document> {
    const doc = await this.deps.documents.findById(organizationId, documentId);
    if (!doc) throw new NotFoundError('Document');
    const acls = await this.deps.documents.listAcls(documentId);
    if (!canAccessDocument(acls, principal, { adminBypass: true })) {
      throw new ForbiddenError('You do not have access to this document');
    }
    return doc;
  }

  async list(
    organizationId: string,
    principal: AclPrincipal,
    limit: number,
    cursor?: string,
  ): Promise<{ documents: Document[]; nextCursor: string | null }> {
    const rows = await this.deps.documents.list(organizationId, limit + 1, cursor);
    const page = rows.slice(0, limit);
    const acls = await this.deps.documents.getAclsForDocuments(page.map((d) => d.id));
    const byDoc = new Map<string, typeof acls>();
    for (const acl of acls) {
      const list = byDoc.get(acl.documentId) ?? [];
      list.push(acl);
      byDoc.set(acl.documentId, list);
    }
    const visible = page.filter((d) =>
      canAccessDocument(byDoc.get(d.id) ?? [], principal, { adminBypass: true }),
    );
    return {
      documents: visible,
      nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  async softDelete(
    organizationId: string,
    documentId: string,
    principal: AclPrincipal,
  ): Promise<void> {
    await this.get(organizationId, documentId, principal);
    if (!roleSatisfiesAdmin(principal.role)) {
      throw new ForbiddenError('Only admins can delete documents');
    }
    await this.deps.documents.softDelete(organizationId, documentId);
    await this.deps.prisma.documentChunk.deleteMany({ where: { documentId, organizationId } });
    await this.deps.audit.record({
      organizationId,
      actorUserId: principal.userId,
      action: AuditAction.DocumentDeleted,
      resourceType: 'document',
      resourceId: documentId,
    });
  }

  async replaceAcls(
    organizationId: string,
    documentId: string,
    principal: AclPrincipal,
    entries: { subjectType: 'USER' | 'TEAM' | 'ROLE'; subjectId: string; permission: 'READ' | 'WRITE' | 'ADMIN' }[],
  ) {
    await this.get(organizationId, documentId, principal);
    if (!roleSatisfiesAdmin(principal.role)) {
      throw new ForbiddenError('Only admins can manage document ACLs');
    }
    return this.deps.documents.replaceAcls(
      organizationId,
      documentId,
      entries.map((e) => ({
        id: newId(IdPrefix.documentAcl),
        subjectType: e.subjectType,
        subjectId: e.subjectId,
        permission: e.permission,
      })),
    );
  }
}

function roleSatisfiesAdmin(role: Role): boolean {
  return role === Role.OWNER || role === Role.ADMIN;
}
