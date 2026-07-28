import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, ForbiddenError, Role, UnauthorizedError } from '@akp/core';
import { InvalidCredentialsError, TokenInvalidError } from '../../lib/auth-errors.js';
import { hashPassword, hashToken } from '../../lib/crypto.js';
import { AuthService, type AuthServiceDeps } from './auth.service.js';

const MEMORY_COST = 8192;

function makeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'usr_1',
    email: 'user@acme.test',
    name: 'User',
    passwordHash: null,
    googleSub: null,
    avatarUrl: null,
    mfaEnabled: false,
    status: 'ACTIVE',
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeOrg() {
  return {
    id: 'org_1',
    name: 'Acme',
    slug: 'acme',
    status: 'ACTIVE',
    settings: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
}

function makeDeps() {
  const users = {
    findByEmail: vi.fn(),
    findById: vi.fn(),
    findByGoogleSub: vi.fn(),
    linkGoogleSub: vi.fn(),
    create: vi.fn(),
    update: vi.fn(async (id: string, data: Record<string, unknown>) =>
      makeUser({ id, ...data }),
    ),
    touchLastLogin: vi.fn().mockResolvedValue(undefined),
    withTx() {
      return users;
    },
  };
  const organizations = {
    findBySlug: vi.fn().mockResolvedValue(null),
    findById: vi.fn(),
    create: vi.fn(),
    withTx() {
      return organizations;
    },
  };
  const memberships = {
    create: vi.fn(),
    listActiveByUser: vi.fn(),
    withTx() {
      return memberships;
    },
  };
  const sessions = {
    create: vi.fn().mockResolvedValue(undefined),
    findByTokenHash: vi.fn(),
    revoke: vi.fn().mockResolvedValue(undefined),
    revokeAllForUser: vi.fn().mockResolvedValue(1),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const jwt = {
    signAccessToken: vi.fn().mockResolvedValue('access.jwt.token'),
    signMfaPendingToken: vi.fn().mockResolvedValue('mfa.pending.token'),
    verifyMfaPendingToken: vi.fn(),
  };
  const prisma = {
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({})),
  };
  const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };

  const deps = {
    prisma,
    users,
    organizations,
    memberships,
    sessions,
    audit,
    jwt,
    logger,
    config: { accessTtl: 900, refreshTtl: 1000, passwordHashMemoryCost: MEMORY_COST },
  } as unknown as AuthServiceDeps;

  return { deps, mocks: { users, organizations, memberships, sessions, audit, jwt, prisma } };
}

describe('AuthService.register', () => {
  let ctx: ReturnType<typeof makeDeps>;
  beforeEach(() => {
    ctx = makeDeps();
  });

  it('creates org, user, and owner membership and returns tokens', async () => {
    ctx.mocks.users.findByEmail.mockResolvedValue(null);
    ctx.mocks.organizations.create.mockResolvedValue(makeOrg());
    ctx.mocks.users.create.mockResolvedValue(makeUser({ passwordHash: 'hash' }));
    ctx.mocks.memberships.create.mockResolvedValue({});

    const service = new AuthService(ctx.deps);
    const result = await service.register(
      { email: 'User@Acme.test', password: 'Password123!', name: 'User', organizationName: 'Acme' },
      { ipAddress: '127.0.0.1', userAgent: 'test' },
    );

    expect(result.role).toBe(Role.OWNER);
    expect(result.tokens.accessToken).toBe('access.jwt.token');
    expect(result.tokens.refreshToken).toBeTruthy();
    expect(ctx.mocks.memberships.create).toHaveBeenCalledWith(
      expect.objectContaining({ role: Role.OWNER, organizationId: 'org_1' }),
    );
    // Two audit events: org.created and user.registered.
    expect(ctx.mocks.audit.record).toHaveBeenCalledTimes(2);
  });

  it('rejects duplicate email with a generic conflict', async () => {
    ctx.mocks.users.findByEmail.mockResolvedValue(makeUser());
    const service = new AuthService(ctx.deps);
    await expect(
      service.register(
        { email: 'user@acme.test', password: 'Password123!', name: 'U', organizationName: 'Acme' },
        {},
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('AuthService.loginOrRegisterWithGoogle', () => {
  let ctx: ReturnType<typeof makeDeps>;
  beforeEach(() => {
    ctx = makeDeps();
  });

  const identity = {
    sub: 'google-sub-123',
    email: 'Ada@Example.com',
    emailVerified: true,
    name: 'Ada Lovelace',
    avatarUrl: 'https://pic',
  };

  it('provisions a new organization + owner on first Google sign-up', async () => {
    ctx.mocks.users.findByGoogleSub.mockResolvedValue(null);
    ctx.mocks.users.findByEmail.mockResolvedValue(null);
    ctx.mocks.organizations.create.mockResolvedValue(makeOrg());
    ctx.mocks.users.create.mockResolvedValue(
      makeUser({ email: 'ada@example.com', googleSub: identity.sub }),
    );
    ctx.mocks.memberships.create.mockResolvedValue({});

    const service = new AuthService(ctx.deps);
    const result = await service.loginOrRegisterWithGoogle(identity, {});

    expect(result.role).toBe(Role.OWNER);
    expect(result.tokens.accessToken).toBe('access.jwt.token');
    // New user is created with the Google subject and no password.
    expect(ctx.mocks.users.create).toHaveBeenCalledWith(
      expect.objectContaining({ googleSub: identity.sub, email: 'ada@example.com' }),
    );
    expect(ctx.mocks.users.create).toHaveBeenCalledWith(
      expect.not.objectContaining({ passwordHash: expect.anything() }),
    );
    // org.created + user.registered.
    expect(ctx.mocks.audit.record).toHaveBeenCalledTimes(2);
  });

  it('links the Google subject to an existing password account and signs in', async () => {
    ctx.mocks.users.findByGoogleSub.mockResolvedValue(null);
    ctx.mocks.users.findByEmail.mockResolvedValue(
      makeUser({ email: 'ada@example.com', passwordHash: 'h', googleSub: null }),
    );
    ctx.mocks.users.linkGoogleSub.mockResolvedValue(
      makeUser({ email: 'ada@example.com', passwordHash: 'h', googleSub: identity.sub }),
    );
    ctx.mocks.memberships.listActiveByUser.mockResolvedValue([
      { organizationId: 'org_1', role: Role.ADMIN, organization: makeOrg() },
    ]);

    const service = new AuthService(ctx.deps);
    const result = await service.loginOrRegisterWithGoogle(identity, {});

    expect(ctx.mocks.users.linkGoogleSub).toHaveBeenCalledWith('usr_1', identity.sub);
    expect(ctx.mocks.users.touchLastLogin).toHaveBeenCalledWith('usr_1');
    expect(result.role).toBe(Role.ADMIN);
    // No new organization is provisioned for an existing account.
    expect(ctx.mocks.organizations.create).not.toHaveBeenCalled();
  });

  it('signs in an account already linked by Google subject without re-linking', async () => {
    ctx.mocks.users.findByGoogleSub.mockResolvedValue(
      makeUser({ email: 'ada@example.com', googleSub: identity.sub }),
    );
    ctx.mocks.memberships.listActiveByUser.mockResolvedValue([
      { organizationId: 'org_1', role: Role.MEMBER, organization: makeOrg() },
    ]);

    const service = new AuthService(ctx.deps);
    const result = await service.loginOrRegisterWithGoogle(identity, {});

    expect(result.role).toBe(Role.MEMBER);
    expect(ctx.mocks.users.findByEmail).not.toHaveBeenCalled();
    expect(ctx.mocks.users.linkGoogleSub).not.toHaveBeenCalled();
  });

  it('rejects an unverified Google email', async () => {
    const service = new AuthService(ctx.deps);
    await expect(
      service.loginOrRegisterWithGoogle({ ...identity, emailVerified: false }, {}),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(ctx.mocks.users.findByGoogleSub).not.toHaveBeenCalled();
  });

  it('rejects when the email is already linked to a different Google subject', async () => {
    ctx.mocks.users.findByGoogleSub.mockResolvedValue(null);
    ctx.mocks.users.findByEmail.mockResolvedValue(
      makeUser({ email: 'ada@example.com', googleSub: 'google-sub-other' }),
    );

    const service = new AuthService(ctx.deps);
    await expect(service.loginOrRegisterWithGoogle(identity, {})).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(ctx.mocks.users.linkGoogleSub).not.toHaveBeenCalled();
  });

  it('challenges MFA for an existing MFA-enabled account instead of issuing a session', async () => {
    ctx.mocks.users.findByGoogleSub.mockResolvedValue(
      makeUser({
        email: 'ada@example.com',
        googleSub: identity.sub,
        mfaEnabled: true,
        avatarUrl: 'https://pic',
      }),
    );
    ctx.mocks.memberships.listActiveByUser.mockResolvedValue([
      { organizationId: 'org_1', role: Role.MEMBER, organization: makeOrg() },
    ]);

    const service = new AuthService(ctx.deps);
    await expect(service.loginOrRegisterWithGoogle(identity, {})).rejects.toMatchObject({
      code: 'MFA_REQUIRED',
      details: { mfaToken: 'mfa.pending.token' },
    });
    expect(ctx.mocks.jwt.signMfaPendingToken).toHaveBeenCalledWith('usr_1');
    expect(ctx.mocks.sessions.create).not.toHaveBeenCalled();
  });
});

describe('AuthService.login', () => {
  let ctx: ReturnType<typeof makeDeps>;
  let passwordHash: string;
  beforeEach(async () => {
    ctx = makeDeps();
    passwordHash = await hashPassword('Password123!', MEMORY_COST);
  });

  it('issues tokens for valid credentials', async () => {
    ctx.mocks.users.findByEmail.mockResolvedValue(makeUser({ passwordHash }));
    ctx.mocks.memberships.listActiveByUser.mockResolvedValue([
      { organizationId: 'org_1', role: Role.MEMBER, organization: makeOrg() },
    ]);

    const service = new AuthService(ctx.deps);
    const result = await service.login(
      { email: 'user@acme.test', password: 'Password123!' },
      {},
    );

    expect(result.role).toBe(Role.MEMBER);
    expect(result.tokens.refreshToken).toBeTruthy();
    expect(ctx.mocks.users.touchLastLogin).toHaveBeenCalledWith('usr_1');
  });

  it('rejects an invalid password', async () => {
    ctx.mocks.users.findByEmail.mockResolvedValue(makeUser({ passwordHash }));
    const service = new AuthService(ctx.deps);
    await expect(
      service.login({ email: 'user@acme.test', password: 'wrong-password' }, {}),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('rejects an unknown user (without leaking existence)', async () => {
    ctx.mocks.users.findByEmail.mockResolvedValue(null);
    const service = new AuthService(ctx.deps);
    await expect(
      service.login({ email: 'nope@acme.test', password: 'whatever123' }, {}),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('forbids login when the user has no active organization', async () => {
    ctx.mocks.users.findByEmail.mockResolvedValue(makeUser({ passwordHash }));
    ctx.mocks.memberships.listActiveByUser.mockResolvedValue([]);
    const service = new AuthService(ctx.deps);
    await expect(
      service.login({ email: 'user@acme.test', password: 'Password123!' }, {}),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('AuthService.refresh', () => {
  let ctx: ReturnType<typeof makeDeps>;
  beforeEach(() => {
    ctx = makeDeps();
  });

  it('rotates a valid refresh token and revokes the old session', async () => {
    const raw = 'valid-refresh-token';
    ctx.mocks.sessions.findByTokenHash.mockResolvedValue({
      id: 'ses_old',
      userId: 'usr_1',
      tokenHash: hashToken(raw),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 100_000),
    });
    ctx.mocks.users.findById.mockResolvedValue(makeUser({ passwordHash: 'h' }));
    ctx.mocks.memberships.listActiveByUser.mockResolvedValue([
      { organizationId: 'org_1', role: Role.MEMBER, organization: makeOrg() },
    ]);

    const service = new AuthService(ctx.deps);
    const result = await service.refresh(raw, {});

    expect(result.tokens.refreshToken).toBeTruthy();
    expect(result.tokens.refreshToken).not.toBe(raw);
    // Old session revoked, pointing at the new session id.
    expect(ctx.mocks.sessions.revoke).toHaveBeenCalledWith('ses_old', expect.stringMatching(/^ses_/));
  });

  it('detects reuse of a revoked token and burns the session family', async () => {
    const raw = 'reused-token';
    ctx.mocks.sessions.findByTokenHash.mockResolvedValue({
      id: 'ses_old',
      userId: 'usr_1',
      tokenHash: hashToken(raw),
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 100_000),
    });
    ctx.mocks.memberships.listActiveByUser.mockResolvedValue([
      { organizationId: 'org_1', role: Role.MEMBER, organization: makeOrg() },
    ]);

    const service = new AuthService(ctx.deps);
    await expect(service.refresh(raw, {})).rejects.toBeInstanceOf(TokenInvalidError);
    expect(ctx.mocks.sessions.revokeAllForUser).toHaveBeenCalledWith('usr_1');
  });

  it('rejects an unknown refresh token', async () => {
    ctx.mocks.sessions.findByTokenHash.mockResolvedValue(null);
    const service = new AuthService(ctx.deps);
    await expect(service.refresh('nope', {})).rejects.toBeInstanceOf(TokenInvalidError);
  });
});
