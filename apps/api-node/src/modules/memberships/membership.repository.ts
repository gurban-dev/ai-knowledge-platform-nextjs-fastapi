import type { Membership, Organization, Role, User } from '@akp/db';
import { BaseRepository } from '../../lib/repository.js';

export interface CreateMembershipInput {
  id: string;
  organizationId: string;
  userId: string;
  role: Role;
}

export type MembershipWithOrganization = Membership & { organization: Organization };
export type MembershipWithUser = Membership & { user: User };

export class MembershipRepository extends BaseRepository<MembershipRepository> {
  async create(input: CreateMembershipInput): Promise<Membership> {
    return this.db.membership.create({
      data: {
        id: input.id,
        organizationId: input.organizationId,
        userId: input.userId,
        role: input.role,
      },
    });
  }

  async findByOrgAndUser(organizationId: string, userId: string): Promise<Membership | null> {
    return this.db.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });
  }

  /** All active memberships for a user, with their organizations eager-loaded. */
  async listActiveByUser(userId: string): Promise<MembershipWithOrganization[]> {
    return this.db.membership.findMany({
      where: { userId, status: 'ACTIVE' },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listByOrganization(organizationId: string): Promise<Membership[]> {
    return this.db.membership.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Members of an organization with their user records eager-loaded. */
  async listByOrganizationWithUsers(organizationId: string): Promise<MembershipWithUser[]> {
    return this.db.membership.findMany({
      where: { organizationId },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
  }
}
