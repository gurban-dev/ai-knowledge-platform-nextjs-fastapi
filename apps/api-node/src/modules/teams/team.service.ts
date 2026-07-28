import { IdPrefix, newId, NotFoundError, ConflictError, ErrorCode } from '@akp/core';
import type { PrismaClient, Role } from '@akp/db';
import type { AuditService } from '../audit/audit.service.js';
import { AuditAction } from '../audit/audit.service.js';
import { slugify } from '../auth/slug.js';

export class TeamService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  async create(params: {
    organizationId: string;
    userId: string;
    name: string;
    description?: string;
  }) {
    const slug = slugify(params.name);
    const existing = await this.prisma.team.findUnique({
      where: { organizationId_slug: { organizationId: params.organizationId, slug } },
    });
    if (existing) {
      throw new ConflictError('Team slug already exists', ErrorCode.ALREADY_EXISTS);
    }
    const team = await this.prisma.team.create({
      data: {
        id: newId(IdPrefix.team),
        organizationId: params.organizationId,
        name: params.name,
        slug,
        description: params.description ?? null,
        members: {
          create: {
            id: newId(IdPrefix.teamMembership),
            userId: params.userId,
            role: 'ADMIN',
          },
        },
      },
    });
    await this.audit.record({
      organizationId: params.organizationId,
      actorUserId: params.userId,
      action: AuditAction.TeamCreated,
      resourceType: 'team',
      resourceId: team.id,
    });
    return team;
  }

  async list(organizationId: string) {
    return this.prisma.team.findMany({
      where: { organizationId },
      include: { members: true },
      orderBy: { name: 'asc' },
    });
  }

  async addMember(organizationId: string, teamId: string, userId: string, role: Role = 'MEMBER') {
    const team = await this.prisma.team.findFirst({ where: { id: teamId, organizationId } });
    if (!team) throw new NotFoundError('Team');
    return this.prisma.teamMembership.create({
      data: {
        id: newId(IdPrefix.teamMembership),
        teamId,
        userId,
        role,
      },
    });
  }

  async removeMember(organizationId: string, teamId: string, userId: string) {
    const team = await this.prisma.team.findFirst({ where: { id: teamId, organizationId } });
    if (!team) throw new NotFoundError('Team');
    await this.prisma.teamMembership.delete({
      where: { teamId_userId: { teamId, userId } },
    });
  }

  async delete(organizationId: string, teamId: string, actorUserId: string) {
    const team = await this.prisma.team.findFirst({ where: { id: teamId, organizationId } });
    if (!team) throw new NotFoundError('Team');
    await this.prisma.team.delete({ where: { id: teamId } });
    await this.audit.record({
      organizationId,
      actorUserId,
      action: AuditAction.TeamDeleted,
      resourceType: 'team',
      resourceId: teamId,
    });
  }

  async listTeamIdsForUser(organizationId: string, userId: string): Promise<string[]> {
    const rows = await this.prisma.teamMembership.findMany({
      where: { userId, team: { organizationId } },
      select: { teamId: true },
    });
    return rows.map((r) => r.teamId);
  }
}
