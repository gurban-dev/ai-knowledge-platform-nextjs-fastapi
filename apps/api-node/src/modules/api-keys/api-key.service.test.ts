import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError, UnauthorizedError, ValidationError } from '@akp/core';
import type { ApiKey } from '@akp/db';
import { ApiKeyService } from './api-key.service.js';
import type { ApiKeyRepository } from './api-key.repository.js';

function makeKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: 'key_1',
    organizationId: 'org_1',
    name: 'CI',
    description: null,
    keyHash: 'hash',
    prefix: 'akp_xxxxx',
    status: 'ACTIVE',
    scopes: ['documents:read'],
    rateLimitPerMinute: null,
    ipAllowlist: [],
    createdById: null,
    lastUsedAt: null,
    lastRotatedAt: null,
    expiresAt: null,
    revokedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeRepo() {
  const store = new Map<string, ApiKey>();
  const repo = {
    create: vi.fn(async (data: { id: string; keyHash: string; organizationId: string; name: string; prefix: string; scopes: string[] }) => {
      const key = makeKey({
        id: data.id,
        organizationId: data.organizationId,
        name: data.name,
        prefix: data.prefix,
        keyHash: data.keyHash,
        scopes: data.scopes,
      });
      store.set(data.keyHash, key);
      return key;
    }),
    findById: vi.fn(async (id: string, organizationId: string) =>
      [...store.values()].find((k) => k.id === id && k.organizationId === organizationId) ?? null,
    ),
    findByHash: vi.fn(async (keyHash: string) => store.get(keyHash) ?? null),
    listByOrganization: vi.fn(async (organizationId: string) =>
      [...store.values()].filter((k) => k.organizationId === organizationId),
    ),
    revoke: vi.fn(async () => ({ count: 1 })),
    rotate: vi.fn(async () => ({ count: 1 })),
    touchLastUsed: vi.fn(async () => undefined),
  };
  return { repo, store };
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;

describe('ApiKeyService.create', () => {
  let ctx: ReturnType<typeof makeRepo>;
  beforeEach(() => {
    ctx = makeRepo();
  });

  it('mints a prefixed secret and stores only its hash', async () => {
    const service = new ApiKeyService(ctx.repo as unknown as ApiKeyRepository, logger);
    const { secret, key } = await service.create({
      organizationId: 'org_1',
      name: 'CI',
      scopes: ['documents:read'],
    });
    expect(secret.startsWith('akp_')).toBe(true);
    expect(key.prefix.startsWith('akp_')).toBe(true);
    // Stored hash equals SHA-256 of the secret; secret itself is never stored.
    const stored = [...ctx.store.values()][0]!;
    expect(stored.keyHash).toBe(createHash('sha256').update(secret).digest('hex'));
  });

  it('rejects unknown scopes', async () => {
    const service = new ApiKeyService(ctx.repo as unknown as ApiKeyRepository, logger);
    await expect(
      service.create({ organizationId: 'org_1', name: 'x', scopes: ['documents:delete'] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('ApiKeyService.verify', () => {
  let ctx: ReturnType<typeof makeRepo>;
  let service: ApiKeyService;
  let secret: string;

  beforeEach(async () => {
    ctx = makeRepo();
    service = new ApiKeyService(ctx.repo as unknown as ApiKeyRepository, logger);
    ({ secret } = await service.create({
      organizationId: 'org_1',
      name: 'CI',
      scopes: ['documents:read'],
    }));
  });

  it('authenticates a valid secret', async () => {
    const verified = await service.verify(secret, { ip: '10.0.0.1' });
    expect(verified.organizationId).toBe('org_1');
    expect(verified.scopes).toContain('documents:read');
  });

  it('rejects a malformed key', async () => {
    await expect(service.verify('not-a-key', { ip: '10.0.0.1' })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('rejects an unknown key', async () => {
    await expect(service.verify('akp_unknown', { ip: '10.0.0.1' })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('rejects an expired key', async () => {
    const stored = [...ctx.store.values()][0]!;
    stored.expiresAt = new Date(Date.now() - 1000);
    await expect(service.verify(secret, { ip: '10.0.0.1' })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('enforces the IP allowlist', async () => {
    const stored = [...ctx.store.values()][0]!;
    stored.ipAllowlist = ['192.168.0.0/16'];
    await expect(service.verify(secret, { ip: '10.0.0.1' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(service.verify(secret, { ip: '192.168.1.10' })).resolves.toBeTruthy();
  });
});
