import type { Organization, Prisma } from '@akp/db';
import { BaseRepository } from '../../lib/repository.js';

export interface CreateOrganizationInput {
  id: string;
  name: string;
  slug: string;
}

export class OrganizationRepository extends BaseRepository<OrganizationRepository> {
  async findById(id: string): Promise<Organization | null> {
    return this.db.organization.findUnique({ where: { id } });
  }

  async findBySlug(slug: string): Promise<Organization | null> {
    return this.db.organization.findUnique({ where: { slug } });
  }

  async create(input: CreateOrganizationInput): Promise<Organization> {
    return this.db.organization.create({
      data: { id: input.id, name: input.name, slug: input.slug },
    });
  }

  async updateSettings(
    organizationId: string,
    settings: Prisma.InputJsonValue,
  ): Promise<Organization> {
    return this.db.organization.update({
      where: { id: organizationId },
      data: { settings },
    });
  }
}
