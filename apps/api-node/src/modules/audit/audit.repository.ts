import type { AuditLog, Prisma } from '@akp/db';
import { BaseRepository } from '../../lib/repository.js';

export interface CreateAuditLogInput {
  id: string;
  organizationId: string;
  actorUserId?: string | undefined;
  action: string;
  resourceType?: string | undefined;
  resourceId?: string | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  metadata?: Prisma.InputJsonValue | undefined;
}

export class AuditRepository extends BaseRepository<AuditRepository> {
  async create(input: CreateAuditLogInput): Promise<AuditLog> {
    return this.db.auditLog.create({
      data: {
        id: input.id,
        organizationId: input.organizationId,
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        metadata: input.metadata ?? {},
      },
    });
  }

  /** List an organization's audit trail, newest first (cursor-paginated by id+createdAt). */
  async listByOrganization(
    organizationId: string,
    take: number,
    cursorId?: string,
  ): Promise<AuditLog[]> {
    return this.db.auditLog.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
    });
  }
}
