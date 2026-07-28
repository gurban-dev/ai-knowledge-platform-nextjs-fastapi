import { createHash, randomBytes } from 'node:crypto';
import {
  ForbiddenError,
  IdPrefix,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  areValidScopes,
  newId,
} from '@akp/core';
import type { ApiKey } from '@akp/db';
import type { Logger } from '@akp/observability';
import { ipMatchesAllowlist } from '../../lib/ip.js';
import type { ApiKeyRepository } from './api-key.repository.js';

/** Human-facing representation of a key (never includes the secret or hash). */
export interface ApiKeyDto {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  prefix: string;
  status: string;
  scopes: string[];
  rateLimitPerMinute: number | null;
  ipAllowlist: string[];
  createdById: string | null;
  lastUsedAt: string | null;
  lastRotatedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface CreateApiKeyInput {
  organizationId: string;
  name: string;
  description?: string | undefined;
  scopes: string[];
  rateLimitPerMinute?: number | undefined;
  ipAllowlist?: string[] | undefined;
  createdById?: string | undefined;
  expiresAt?: Date | undefined;
}

/** Verified API-key principal attached to programmatic requests. */
export interface VerifiedApiKey {
  id: string;
  organizationId: string;
  name: string;
  scopes: string[];
  rateLimitPerMinute: number | null;
}

const KEY_PREFIX = 'akp';

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function toDto(key: ApiKey): ApiKeyDto {
  return {
    id: key.id,
    organizationId: key.organizationId,
    name: key.name,
    description: key.description,
    prefix: key.prefix,
    status: key.status,
    scopes: key.scopes,
    rateLimitPerMinute: key.rateLimitPerMinute,
    ipAllowlist: key.ipAllowlist,
    createdById: key.createdById,
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    lastRotatedAt: key.lastRotatedAt?.toISOString() ?? null,
    expiresAt: key.expiresAt?.toISOString() ?? null,
    createdAt: key.createdAt.toISOString(),
  };
}

export class ApiKeyService {
  constructor(
    private readonly repository: ApiKeyRepository,
    private readonly logger: Logger,
  ) {}

  /** Mint a new key. Returns the one-time plaintext secret alongside the record. */
  async create(input: CreateApiKeyInput): Promise<{ secret: string; key: ApiKeyDto }> {
    if (!areValidScopes(input.scopes)) {
      throw new ValidationError('One or more scopes are not recognized', {
        scopes: input.scopes,
      });
    }
    const { secret, prefix, keyHash } = this.mintSecret();
    const record = await this.repository.create({
      id: newId(IdPrefix.apiKey),
      organizationId: input.organizationId,
      name: input.name,
      description: input.description ?? null,
      keyHash,
      prefix,
      scopes: input.scopes,
      rateLimitPerMinute: input.rateLimitPerMinute ?? null,
      ipAllowlist: input.ipAllowlist ?? [],
      createdById: input.createdById ?? null,
      expiresAt: input.expiresAt ?? null,
    });
    this.logger.info(
      { organizationId: input.organizationId, keyId: record.id, scopes: input.scopes },
      'API key created',
    );
    return { secret, key: toDto(record) };
  }

  async list(organizationId: string): Promise<ApiKeyDto[]> {
    const keys = await this.repository.listByOrganization(organizationId);
    return keys.map(toDto);
  }

  async revoke(id: string, organizationId: string): Promise<void> {
    const result = await this.repository.revoke(id, organizationId);
    if (result.count === 0) throw new NotFoundError('API key');
    this.logger.info({ organizationId, keyId: id }, 'API key revoked');
  }

  /** Rotate: issue a new secret for an existing key, invalidating the old one. */
  async rotate(id: string, organizationId: string): Promise<{ secret: string; key: ApiKeyDto }> {
    const existing = await this.repository.findById(id, organizationId);
    if (!existing) throw new NotFoundError('API key');
    if (existing.status !== 'ACTIVE') {
      throw new ValidationError('Only active keys can be rotated');
    }
    const { secret, prefix, keyHash } = this.mintSecret();
    await this.repository.rotate(id, organizationId, keyHash, prefix);
    const updated = await this.repository.findById(id, organizationId);
    this.logger.info({ organizationId, keyId: id }, 'API key rotated');
    return { secret, key: toDto(updated ?? existing) };
  }

  /**
   * Authenticate a raw secret for programmatic access. Validates status,
   * expiry, and IP allowlist, then records last-used (best effort).
   */
  async verify(rawSecret: string, context: { ip: string }): Promise<VerifiedApiKey> {
    if (!rawSecret.startsWith(`${KEY_PREFIX}_`)) {
      throw new UnauthorizedError('Malformed API key');
    }
    const record = await this.repository.findByHash(hashSecret(rawSecret));
    
    if (record?.status !== 'ACTIVE') {
      throw new UnauthorizedError('Invalid API key');
    }
    
    const expiresAt = record.expiresAt?.getTime();

    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      throw new UnauthorizedError('API key expired');
    }
    
    if (!ipMatchesAllowlist(context.ip, record.ipAllowlist)) {
      throw new ForbiddenError('Source IP is not permitted for this API key');
    }

    // Fire-and-forget; a telemetry write must never fail authentication.
    void this.repository.touchLastUsed(record.id).catch((error) => {
      this.logger.warn({ err: error, keyId: record.id }, 'Failed to record API key usage');
    });
    return {
      id: record.id,
      organizationId: record.organizationId,
      name: record.name,
      scopes: record.scopes,
      rateLimitPerMinute: record.rateLimitPerMinute,
    };
  }

  private mintSecret(): { secret: string; prefix: string; keyHash: string } {
    const random = randomBytes(24).toString('base64url');
    const secret = `${KEY_PREFIX}_${random}`;
    return {
      secret,
      // Store a short, non-sensitive prefix for identification in the UI.
      prefix: secret.slice(0, 11),
      keyHash: hashSecret(secret),
    };
  }
}
