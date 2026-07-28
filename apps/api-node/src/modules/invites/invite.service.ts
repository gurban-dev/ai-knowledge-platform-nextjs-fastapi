import { createHash, randomBytes } from 'node:crypto';
import {
  ConflictError,
  ErrorCode,
  IdPrefix,
  newId,
  NotFoundError,
  ValidationError,
} from '@akp/core';
import type { PrismaClient, Role } from '@akp/db';
import type { AuditService } from '../audit/audit.service.js';
import { AuditAction } from '../audit/audit.service.js';
import type { BillingService } from '../billing/billing.service.js';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class InviteService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly billing: BillingService,
    private readonly audit: AuditService,
  ) {}

  async create(params: {
    organizationId: string;
    email: string;
    role: Role;
    invitedById: string;
  }) {
    await this.billing.checkMemberQuota(params.organizationId);
    const token = `inv_${randomBytes(24).toString('base64url')}`;
    const expiresAt = new Date(Date.now() + 7 * 86_400_000);
    try {
      const invite = await this.prisma.invite.create({
        data: {
          id: newId(IdPrefix.inviteToken),
          organizationId: params.organizationId,
          email: params.email.toLowerCase(),
          role: params.role,
          tokenHash: hashToken(token),
          invitedById: params.invitedById,
          expiresAt,
        },
      });
      await this.audit.record({
        organizationId: params.organizationId,
        actorUserId: params.invitedById,
        action: AuditAction.InviteCreated,
        resourceType: 'invite',
        resourceId: invite.id,
        metadata: { email: invite.email, role: invite.role },
      });
      return { invite, token };
    } catch {
      throw new ConflictError('Invite already exists for this email', ErrorCode.ALREADY_EXISTS);
    }
  }

  async list(organizationId: string) {
    return this.prisma.invite.findMany({
      where: { organizationId, acceptedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(organizationId: string, inviteId: string, actorUserId: string) {
    const invite = await this.prisma.invite.findFirst({
      where: { id: inviteId, organizationId },
    });
    if (!invite) throw new NotFoundError('Invite');
    await this.prisma.invite.delete({ where: { id: inviteId } });
    await this.audit.record({
      organizationId,
      actorUserId,
      action: AuditAction.InviteRevoked,
      resourceType: 'invite',
      resourceId: inviteId,
    });
  }

  async accept(params: {
    token: string;
    name: string;
    passwordHash: string;
  }) {
    const invite = await this.prisma.invite.findUnique({
      where: { tokenHash: hashToken(params.token) },
    });
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
      throw new ValidationError('Invite is invalid or expired');
    }
    await this.billing.checkMemberQuota(invite.organizationId);

    const userId = newId(IdPrefix.user);
    const membershipId = newId(IdPrefix.membership);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.create({
        data: {
          id: userId,
          email: invite.email,
          name: params.name,
          passwordHash: params.passwordHash,
          status: 'ACTIVE',
        },
      });
      await tx.membership.create({
        data: {
          id: membershipId,
          organizationId: invite.organizationId,
          userId,
          role: invite.role,
          status: 'ACTIVE',
        },
      });
      await tx.invite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });
    });

    await this.audit.record({
      organizationId: invite.organizationId,
      actorUserId: userId,
      action: AuditAction.InviteAccepted,
      resourceType: 'invite',
      resourceId: invite.id,
    });

    return { userId, organizationId: invite.organizationId, role: invite.role };
  }
}
