import { NotFoundError } from '@akp/core';
import type { Organization, Role } from '@akp/db';
import type { MembershipRepository } from '../memberships/membership.repository.js';
import type { OrganizationRepository } from './organization.repository.js';
import {
  organizationSettingsSchema,
  type OrganizationSettings,
  type UpdateOrganizationSettingsInput,
} from './organization.schemas.js';

export interface OrganizationMember {
  userId: string;
  email: string;
  name: string;
  role: Role;
  status: string;
  joinedAt: string;
}

export type { OrganizationSettings } from './organization.schemas.js';

/**
 * Parse raw persisted JSON into fully-defaulted, validated settings. Unknown or
 * missing fields fall back to safe defaults so older orgs transparently gain new
 * governance controls without a data migration.
 */
export function parseOrganizationSettings(raw: unknown): OrganizationSettings {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const result = organizationSettingsSchema.safeParse(source);
  if (result.success) return result.data;
  // Never fail a read on legacy/partial data — apply defaults field by field.
  return organizationSettingsSchema.parse({});
}

export class OrganizationService {
  constructor(
    private readonly organizations: OrganizationRepository,
    private readonly memberships: MembershipRepository,
  ) {}

  async getById(organizationId: string): Promise<Organization> {
    const org = await this.organizations.findById(organizationId);
    if (!org) throw new NotFoundError('Organization');
    return org;
  }

  async listMembers(organizationId: string): Promise<OrganizationMember[]> {
    const members = await this.memberships.listByOrganizationWithUsers(organizationId);
    return members.map((m) => ({
      userId: m.userId,
      email: m.user.email,
      name: m.user.name,
      role: m.role,
      status: m.status,
      joinedAt: m.createdAt.toISOString(),
    }));
  }

  async getSettings(organizationId: string): Promise<OrganizationSettings> {
    const org = await this.organizations.findById(organizationId);
    if (!org) throw new NotFoundError('Organization');
    return parseOrganizationSettings(org.settings);
  }

  async updateSettings(
    organizationId: string,
    patch: UpdateOrganizationSettingsInput,
  ): Promise<OrganizationSettings> {
    const current = await this.getSettings(organizationId);
    // Only overwrite fields explicitly provided; validate the merged result.
    const merged = organizationSettingsSchema.parse({
      ...current,
      ...Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      ),
    });
    await this.organizations.updateSettings(organizationId, merged);
    return merged;
  }
}
