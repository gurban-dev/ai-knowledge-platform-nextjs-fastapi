import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConflictError,
  FieldEncryptor,
  MfaInvalidError,
  StaticKeyProvider,
  generateEncryptionKey,
} from '@akp/core';
import type { Prisma, User } from '@akp/db';
import { generateTotp } from '../../lib/totp.js';
import { MfaService } from './mfa.service.js';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'usr_1',
    email: 'user@acme.test',
    passwordHash: 'h',
    name: 'User',
    status: 'ACTIVE',
    avatarUrl: null,
    lastLoginAt: null,
    mfaEnabled: false,
    mfaSecret: null,
    mfaRecoveryCodes: [],
    mfaVerifiedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeDeps() {
  let user = makeUser();
  const users = {
    findById: vi.fn(async () => user),
    update: vi.fn(async (_id: string, data: Prisma.UserUpdateInput) => {
      user = { ...user, ...(data as Partial<User>) };
      return user;
    }),
  };
  const encryptor = new FieldEncryptor(
    new StaticKeyProvider({ activeKeyId: 'k', keys: { k: generateEncryptionKey() } }),
  );
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new MfaService({
    users: users as never,
    encryptor,
    audit: audit as never,
    logger: logger as never,
    issuer: 'AKP',
  });
  return { service, users, getUser: () => user };
}

describe('MfaService enrollment', () => {
  let ctx: ReturnType<typeof makeDeps>;
  beforeEach(() => {
    ctx = makeDeps();
  });

  it('enrolls, activates with a valid code, and returns recovery codes', async () => {
    const { secret, otpauthUri } = await ctx.service.beginEnrollment('usr_1', 'org_1', {});
    expect(secret).toBeTruthy();
    expect(otpauthUri).toContain('otpauth://');
    // Secret is stored encrypted, not in plaintext.
    expect(ctx.getUser().mfaSecret).toBeTruthy();
    expect(ctx.getUser().mfaSecret).not.toContain(secret);

    const code = generateTotp(secret);
    const { recoveryCodes } = await ctx.service.activate('usr_1', 'org_1', code, {});
    expect(recoveryCodes).toHaveLength(10);
    expect(ctx.getUser().mfaEnabled).toBe(true);
    // Recovery codes are stored hashed.
    expect(ctx.getUser().mfaRecoveryCodes[0]).not.toBe(recoveryCodes[0]);
  });

  it('rejects activation with a wrong code', async () => {
    const { secret } = await ctx.service.beginEnrollment('usr_1', 'org_1', {});
    const wrong = generateTotp(secret) === '000000' ? '111111' : '000000';
    await expect(ctx.service.activate('usr_1', 'org_1', wrong, {})).rejects.toBeInstanceOf(
      MfaInvalidError,
    );
    expect(ctx.getUser().mfaEnabled).toBe(false);
  });

  it('prevents re-enrolling while enabled', async () => {
    const { secret } = await ctx.service.beginEnrollment('usr_1', 'org_1', {});
    await ctx.service.activate('usr_1', 'org_1', generateTotp(secret), {});
    await expect(ctx.service.beginEnrollment('usr_1', 'org_1', {})).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

describe('MfaService verifyForLogin', () => {
  let ctx: ReturnType<typeof makeDeps>;
  let secret: string;
  let recoveryCodes: string[];

  beforeEach(async () => {
    ctx = makeDeps();
    ({ secret } = await ctx.service.beginEnrollment('usr_1', 'org_1', {}));
    ({ recoveryCodes } = await ctx.service.activate('usr_1', 'org_1', generateTotp(secret), {}));
  });

  it('accepts a valid TOTP code', async () => {
    await expect(
      ctx.service.verifyForLogin(ctx.getUser(), { token: generateTotp(secret) }),
    ).resolves.toBeUndefined();
  });

  it('accepts and consumes a recovery code exactly once', async () => {
    const code = recoveryCodes[0]!;
    await expect(
      ctx.service.verifyForLogin(ctx.getUser(), { recoveryCode: code }),
    ).resolves.toBeUndefined();
    // Reusing the same recovery code fails.
    await expect(
      ctx.service.verifyForLogin(ctx.getUser(), { recoveryCode: code }),
    ).rejects.toBeInstanceOf(MfaInvalidError);
  });

  it('rejects when no factor is supplied', async () => {
    await expect(ctx.service.verifyForLogin(ctx.getUser(), {})).rejects.toBeInstanceOf(
      MfaInvalidError,
    );
  });

  it('disables MFA after verifying a factor', async () => {
    await ctx.service.disable('usr_1', 'org_1', { token: generateTotp(secret) }, {});
    expect(ctx.getUser().mfaEnabled).toBe(false);
    expect(ctx.getUser().mfaSecret).toBeNull();
  });
});
