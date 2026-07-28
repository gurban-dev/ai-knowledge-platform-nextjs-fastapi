import type {
  AclPermission,
  AclSubjectType,
  Document,
  DocumentAcl,
  DocumentStatus,
} from '@akp/db';
import { type Prisma } from '@akp/db';
import { BaseRepository } from '../../lib/repository.js';

export interface CreateDocumentData {
  id: string;
  organizationId: string;
  dataSourceId?: string | null;
  title: string;
  sourceUri?: string | null;
  storedObjectId?: string | null;
  mimeType: string;
  contentHash: string;
  byteSize: bigint;
  chunkingStrategy?: string;
  metadata?: Prisma.InputJsonValue;
  status?: DocumentStatus;
}

export class DocumentRepository extends BaseRepository<DocumentRepository> {
  async create(data: CreateDocumentData): Promise<Document> {
    return this.db.document.create({
      data: {
        id: data.id,
        organizationId: data.organizationId,
        dataSourceId: data.dataSourceId ?? null,
        title: data.title,
        sourceUri: data.sourceUri ?? null,
        storedObjectId: data.storedObjectId ?? null,
        mimeType: data.mimeType,
        contentHash: data.contentHash,
        byteSize: data.byteSize,
        chunkingStrategy: data.chunkingStrategy ?? 'recursive-v1',
        metadata: data.metadata ?? {},
        status: data.status ?? 'PENDING',
      },
    });
  }

  async findById(organizationId: string, id: string): Promise<Document | null> {
    return this.db.document.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
  }

  async findByContentHash(
    organizationId: string,
    contentHash: string,
  ): Promise<Document | null> {
    return this.db.document.findFirst({
      where: { organizationId, contentHash, deletedAt: null },
    });
  }

  async list(
    organizationId: string,
    take: number,
    cursorId?: string,
  ): Promise<Document[]> {
    return this.db.document.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
    });
  }

  async updateStatus(
    _organizationId: string,
    id: string,
    status: DocumentStatus,
    extra?: { error?: string | null; indexedAt?: Date | null },
  ): Promise<Document> {
    const data: Prisma.DocumentUpdateInput = { status };
    if (extra?.error !== undefined) data.error = extra.error;
    if (status === 'INDEXED') {
      data.indexedAt = extra?.indexedAt ?? new Date();
    } else if (extra?.indexedAt !== undefined) {
      data.indexedAt = extra.indexedAt;
    }
    return this.db.document.update({ where: { id }, data });
  }

  async softDelete(_organizationId: string, id: string): Promise<Document> {
    return this.db.document.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'ARCHIVED' },
    });
  }

  async countActive(organizationId: string): Promise<number> {
    return this.db.document.count({
      where: { organizationId, deletedAt: null },
    });
  }

  async listAcls(documentId: string): Promise<DocumentAcl[]> {
    return this.db.documentAcl.findMany({ where: { documentId } });
  }

  async replaceAcls(
    organizationId: string,
    documentId: string,
    entries: {
      id: string;
      subjectType: AclSubjectType;
      subjectId: string;
      permission: AclPermission;
    }[],
  ): Promise<DocumentAcl[]> {
    await this.db.documentAcl.deleteMany({ where: { documentId, organizationId } });
    if (entries.length === 0) return [];
    await this.db.documentAcl.createMany({
      data: entries.map((e) => ({
        id: e.id,
        organizationId,
        documentId,
        subjectType: e.subjectType,
        subjectId: e.subjectId,
        permission: e.permission,
      })),
    });
    return this.listAcls(documentId);
  }

  async listAccessibleDocumentIds(
    organizationId: string,
    candidateIds: string[],
  ): Promise<string[]> {
    if (candidateIds.length === 0) return [];
    const docs = await this.db.document.findMany({
      where: { organizationId, id: { in: candidateIds }, deletedAt: null },
      select: { id: true, acls: { select: { subjectType: true, subjectId: true } } },
    });
    return docs.map((d) => d.id);
  }

  async getAclsForDocuments(documentIds: string[]): Promise<DocumentAcl[]> {
    if (documentIds.length === 0) return [];
    return this.db.documentAcl.findMany({
      where: { documentId: { in: documentIds } },
    });
  }
}
