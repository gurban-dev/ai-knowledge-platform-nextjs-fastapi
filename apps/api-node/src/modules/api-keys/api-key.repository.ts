import type { ApiKey, Prisma } from '@akp/db';
import { BaseRepository } from '../../lib/repository.js';

export interface CreateApiKeyData {
  id: string;
  organizationId: string;
  name: string;
  description?: string | null;
  keyHash: string;
  prefix: string;
  scopes: string[];
  rateLimitPerMinute?: number | null;
  ipAllowlist?: string[];
  createdById?: string | null;
  expiresAt?: Date | null;
}

/**
 * Persistence for organization-scoped API keys. Only the SHA-256 hash of the
 * secret is stored; the raw key is shown exactly once at creation time.
 */
export class ApiKeyRepository extends BaseRepository<ApiKeyRepository> {
  async create(data: CreateApiKeyData): Promise<ApiKey> {
    return this.db.apiKey.create({
      data: {
        id: data.id,
        organizationId: data.organizationId,
        name: data.name,
        description: data.description ?? null,
        keyHash: data.keyHash,
        prefix: data.prefix,
        scopes: data.scopes,
        rateLimitPerMinute: data.rateLimitPerMinute ?? null,
        ipAllowlist: data.ipAllowlist ?? [],
        createdById: data.createdById ?? null,
        expiresAt: data.expiresAt ?? null,
      },
    });
  }

  async findById(id: string, organizationId: string): Promise<ApiKey | null> {
    return this.db.apiKey.findFirst({ where: { id, organizationId } });
  }

  /** Look up by secret hash for authentication (no tenant scope — the key IS the tenant claim). */
  async findByHash(keyHash: string): Promise<ApiKey | null> {
    return this.db.apiKey.findUnique({ where: { keyHash } });
  }

  async listByOrganization(organizationId: string): Promise<ApiKey[]> {
    return this.db.apiKey.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(id: string, organizationId: string): Promise<Prisma.BatchPayload> {
    return this.db.apiKey.updateMany({
      where: { id, organizationId, revokedAt: null },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
  }

  async rotate(
    id: string,
    organizationId: string,
    keyHash: string,
    prefix: string,
  ): Promise<Prisma.BatchPayload> {
    return this.db.apiKey.updateMany({
      where: { id, organizationId, status: 'ACTIVE' },
      data: { keyHash, prefix, lastRotatedAt: new Date() },
    });
  }

  /** Best-effort last-used timestamp; failures must not block a request. */
  async touchLastUsed(id: string): Promise<void> {
    await this.db.apiKey.update({ where: { id }, data: { lastUsedAt: new Date() } });
  }
}
