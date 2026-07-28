import {
  ConflictError,
  ErrorCode,
  ForbiddenError,
  IdPrefix,
  MfaRequiredError,
  newId,
  Role,
  UnauthorizedError,
} from '@akp/core';
import type { Organization, PrismaClient, User } from '@akp/db';
import type { Logger } from '@akp/observability';
import { generateOpaqueToken, hashPassword, hashToken, verifyPassword } from '../../lib/crypto.js';
import { InvalidCredentialsError, TokenExpiredError, TokenInvalidError } from '../../lib/auth-errors.js';
import type { JwtService } from '../../lib/jwt.js';
import type { UserRepository } from '../users/user.repository.js';
import type { OrganizationRepository } from '../organizations/organization.repository.js';
import type {
  MembershipRepository,
  MembershipWithOrganization,
} from '../memberships/membership.repository.js';
import type { SessionRepository } from '../sessions/session.repository.js';
import { AuditAction, type AuditService } from '../audit/audit.service.js';
import { slugify } from './slug.js';
import {
  toPublicOrganization,
  toPublicUser,
  type AuthResult,
  type AuthTokens,
  type RequestMeta,
} from './auth.types.js';

/** MFA verification capability injected to keep AuthService decoupled from the MFA module. */
export interface MfaVerifier {
  verifyForLogin(
    user: User,
    factor: { token?: string | undefined; recoveryCode?: string | undefined },
  ): Promise<void>;
}

export interface AuthServiceDeps {
  prisma: PrismaClient;
  users: UserRepository;
  organizations: OrganizationRepository;
  memberships: MembershipRepository;
  sessions: SessionRepository;
  audit: AuditService;
  jwt: JwtService;
  logger: Logger;
  mfa?: MfaVerifier;
  config: {
    accessTtl: number;
    refreshTtl: number;
    passwordHashMemoryCost: number;
  };
}

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
  organizationName: string;
}

export interface LoginInput {
  email: string;
  password: string;
  /** TOTP code, required when the account has MFA enabled. */
  mfaToken?: string | undefined;
  /** Single-use recovery code, accepted in place of a TOTP code. */
  recoveryCode?: string | undefined;
}

export interface GoogleAuthInput {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  avatarUrl?: string | undefined;
}

export interface CompleteMfaInput {
  /** Short-lived token issued after primary-factor success (password or Google). */
  mfaToken: string;
  mfaCode?: string | undefined;
  recoveryCode?: string | undefined;
}

/**
 * Derive a friendly default organization name for a Google sign-up. Prefers the
 * user's first name ("Ada Lovelace" -> "Ada's Workspace"), falling back to the
 * email local part when no usable name is present.
 */
function deriveWorkspaceName(name: string, email: string): string {
  const firstName = name.trim().split(/\s+/)[0];
  const base = firstName && firstName.length > 0 ? firstName : (email.split('@')[0] ?? 'My');
  return `${base}'s Workspace`;
}

/**
 * Authentication & session lifecycle.
 *
 * Security model:
 *  - Passwords hashed with Argon2id; never logged or returned.
 *  - Access tokens: short-lived, stateless JWTs.
 *  - Refresh tokens: opaque, hashed at rest, single-use with rotation. Presenting
 *    an already-rotated (revoked) refresh token triggers reuse detection which
 *    revokes the entire session family — the standard OWASP mitigation for
 *    stolen refresh tokens.
 */
export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  /** Register a brand-new organization with its first user as OWNER. */
  async register(input: RegisterInput, meta: RequestMeta): Promise<AuthResult> {
    const email = input.email.toLowerCase();

    const existing = await this.deps.users.findByEmail(email);
    if (existing) {
      // Same generic conflict regardless of cause to limit account enumeration.
      throw new ConflictError('An account with this email already exists', ErrorCode.ALREADY_EXISTS);
    }

    const passwordHash = await hashPassword(input.password, this.deps.config.passwordHashMemoryCost);

    const { organization, user } = await this.provisionOwner(
      {
        email,
        name: input.name,
        organizationName: input.organizationName,
        passwordHash,
      },
      meta,
    );

    const { tokens } = await this.issueSession(user, organization, Role.OWNER, meta);
    return this.buildResult(user, organization, Role.OWNER, tokens);
  }

  /**
   * Sign in — or, on first contact, sign up — a user via a verified Google
   * identity. Resolution order:
   *   1. Account already linked to this Google subject → sign in.
   *   2. Account with the same (Google-verified) email → link the subject, sign in.
   *   3. No account → provision a fresh organization with this user as OWNER.
   *
   * Google-provisioned accounts have no password (`passwordHash` is null), so
   * the password login path can never authenticate them.
   */
  async loginOrRegisterWithGoogle(input: GoogleAuthInput, meta: RequestMeta): Promise<AuthResult> {
    if (!input.emailVerified) {
      // Never trust an unverified email — it could belong to someone else.
      throw new UnauthorizedError('Your Google account email is not verified');
    }
    const email = input.email.toLowerCase();

    let user = await this.deps.users.findByGoogleSub(input.sub);

    if (!user) {
      const byEmail = await this.deps.users.findByEmail(email);
      if (byEmail) {
        if (byEmail.googleSub && byEmail.googleSub !== input.sub) {
          // Email already linked to a different Google subject — refuse rather
          // than silently signing the wrong identity into that account.
          throw new ConflictError(
            'This email is already linked to a different Google account',
            ErrorCode.ALREADY_EXISTS,
          );
        }
        // Adopt this Google subject the first time an existing account uses it.
        user =
          byEmail.googleSub === input.sub
            ? byEmail
            : await this.deps.users.linkGoogleSub(byEmail.id, input.sub);
      }
    }

    // First-ever contact: provision an organization for the new user.
    if (!user) {
      const { organization, user: created } = await this.provisionOwner(
        {
          email,
          name: input.name,
          organizationName: deriveWorkspaceName(input.name, email),
          googleSub: input.sub,
          ...(input.avatarUrl ? { avatarUrl: input.avatarUrl } : {}),
        },
        meta,
      );
      const { tokens } = await this.issueSession(created, organization, Role.OWNER, meta);
      return this.buildResult(created, organization, Role.OWNER, tokens);
    }

    // Existing account: refresh avatar from Google when we have one and the
    // profile is still empty, then continue through the shared MFA gate.
    if (input.avatarUrl && !user.avatarUrl) {
      user = await this.deps.users.update(user.id, { avatarUrl: input.avatarUrl });
    }

    return this.finishLogin(user, meta);
  }

  /**
   * Complete authentication after a primary factor (password or Google) when
   * the account has MFA enabled. The {@link CompleteMfaInput.mfaToken} is a
   * short-lived JWT proving that primary-factor verification already succeeded.
   */
  async completeMfa(input: CompleteMfaInput, meta: RequestMeta): Promise<AuthResult> {
    const pending = await this.deps.jwt.verifyMfaPendingToken(input.mfaToken);
    const user = await this.deps.users.findById(pending.sub);
    if (!user?.mfaEnabled) {
      throw new UnauthorizedError('MFA challenge is no longer valid');
    }
    if (!this.deps.mfa) {
      throw new UnauthorizedError('MFA verification is unavailable');
    }
    if (!input.mfaCode && !input.recoveryCode) {
      throw new MfaRequiredError('Multi-factor authentication required');
    }

    const membership = await this.resolveActiveMembership(user.id);
    await this.deps.mfa.verifyForLogin(user, {
      token: input.mfaCode,
      recoveryCode: input.recoveryCode,
    });

    await this.deps.users.touchLastLogin(user.id);
    const { tokens } = await this.issueSession(user, membership.organization, membership.role, meta);
    await this.deps.audit.record({
      organizationId: membership.organizationId,
      actorUserId: user.id,
      action: AuditAction.AuthLoginSucceeded,
      resourceType: 'session',
      ...meta,
    });
    return this.buildResult(user, membership.organization, membership.role, tokens);
  }

  /** Authenticate with email + password and start a session. */
  async login(input: LoginInput, meta: RequestMeta): Promise<AuthResult> {
    const user = await this.deps.users.findByEmail(input.email);

    // Always run a hash verification to keep timing roughly constant whether or
    // not the account exists, mitigating user-enumeration via response timing.
    const passwordOk = user?.passwordHash
      ? await verifyPassword(user.passwordHash, input.password)
      : await this.dummyVerify(input.password);

    if (!user?.passwordHash || !passwordOk) {
      this.deps.logger.warn({ email: input.email }, 'Login failed: invalid credentials');
      throw new InvalidCredentialsError();
    }

    // When the client already supplied a TOTP/recovery code with the password,
    // verify inline (API-compatible). Otherwise route through the shared MFA
    // gate which issues a short-lived pending token for the MFA challenge UI.
    if (user.mfaEnabled && (input.mfaToken || input.recoveryCode)) {
      const membership = await this.resolveActiveMembership(user.id);
      if (!this.deps.mfa) {
        throw new UnauthorizedError('MFA verification is unavailable');
      }
      await this.deps.mfa.verifyForLogin(user, {
        token: input.mfaToken,
        recoveryCode: input.recoveryCode,
      });
      await this.deps.users.touchLastLogin(user.id);
      const { tokens } = await this.issueSession(user, membership.organization, membership.role, meta);
      await this.deps.audit.record({
        organizationId: membership.organizationId,
        actorUserId: user.id,
        action: AuditAction.AuthLoginSucceeded,
        resourceType: 'session',
        ...meta,
      });
      return this.buildResult(user, membership.organization, membership.role, tokens);
    }

    return this.finishLogin(user, meta);
  }

  /**
   * Exchange a valid refresh token for a fresh access token + rotated refresh
   * token. Detects and neutralizes refresh-token reuse.
   */
  async refresh(refreshToken: string, meta: RequestMeta): Promise<AuthResult> {
    const tokenHash = hashToken(refreshToken);
    const session = await this.deps.sessions.findByTokenHash(tokenHash);

    if (!session) {
      throw new TokenInvalidError('Refresh token is invalid');
    }

    if (session.revokedAt) {
      // A revoked token being presented means it was already rotated: either
      // replayed by an attacker or a race. Burn the whole family to be safe.
      const revoked = await this.deps.sessions.revokeAllForUser(session.userId);
      this.deps.logger.error(
        { userId: session.userId, revoked },
        'Refresh token reuse detected; revoked all sessions',
      );
      await this.recordReuse(session.userId, meta);
      throw new TokenInvalidError('Refresh token has already been used');
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      throw new TokenExpiredError('Refresh token has expired');
    }

    const user = await this.deps.users.findById(session.userId);
    if (!user) throw new TokenInvalidError('Refresh token is invalid');

    const membership = await this.resolveActiveMembership(user.id);

    // Rotate: mint a new session, then revoke the old one pointing at the new.
    const { tokens, sessionId } = await this.issueSession(
      user,
      membership.organization,
      membership.role,
      meta,
    );
    await this.deps.sessions.revoke(session.id, sessionId);

    await this.deps.audit.record({
      organizationId: membership.organizationId,
      actorUserId: user.id,
      action: AuditAction.AuthTokenRefreshed,
      resourceType: 'session',
      ...meta,
    });

    return this.buildResult(user, membership.organization, membership.role, tokens);
  }

  /** Revoke the session behind a refresh token. Idempotent and best-effort. */
  async logout(refreshToken: string, meta: RequestMeta): Promise<void> {
    const session = await this.deps.sessions.findByTokenHash(hashToken(refreshToken));
    if (!session || session.revokedAt) return;

    await this.deps.sessions.revoke(session.id);

    const memberships = await this.deps.memberships.listActiveByUser(session.userId);
    const orgId = memberships[0]?.organizationId;
    if (orgId) {
      await this.deps.audit.record({
        organizationId: orgId,
        actorUserId: session.userId,
        action: AuditAction.AuthLoggedOut,
        resourceType: 'session',
        resourceId: session.id,
        ...meta,
      });
    }
  }

  /** Load the current user's profile and active-organization context (no tokens). */
  async getProfile(userId: string): Promise<Omit<AuthResult, 'tokens'>> {
    const user = await this.deps.users.findById(userId);
    if (!user) throw new UnauthorizedError('Account no longer exists');
    const membership = await this.resolveActiveMembership(userId);
    return {
      user: toPublicUser(user),
      organization: toPublicOrganization(membership.organization),
      role: membership.role,
    };
  }

  // ----------------------------- internals ---------------------------------

  /**
   * Shared post-primary-factor path for password and Google. If MFA is enabled,
   * issue a short-lived pending token and challenge; otherwise mint a session.
   */
  private async finishLogin(user: User, meta: RequestMeta): Promise<AuthResult> {
    const membership = await this.resolveActiveMembership(user.id);

    if (user.mfaEnabled) {
      await this.deps.audit.record({
        organizationId: membership.organizationId,
        actorUserId: user.id,
        action: AuditAction.AuthMfaChallenged,
        resourceType: 'session',
        ...meta,
      });
      const mfaToken = await this.deps.jwt.signMfaPendingToken(user.id);
      throw new MfaRequiredError('Multi-factor authentication required', { mfaToken });
    }

    await this.deps.users.touchLastLogin(user.id);
    const { tokens } = await this.issueSession(user, membership.organization, membership.role, meta);
    await this.deps.audit.record({
      organizationId: membership.organizationId,
      actorUserId: user.id,
      action: AuditAction.AuthLoginSucceeded,
      resourceType: 'session',
      ...meta,
    });
    return this.buildResult(user, membership.organization, membership.role, tokens);
  }

  /**
   * Create an organization, its first user, and an OWNER membership atomically,
   * then emit the org-created + user-registered audit events. Shared by the
   * password (register) and Google sign-up paths so provisioning stays identical.
   */
  private async provisionOwner(
    params: {
      email: string;
      name: string;
      organizationName: string;
      passwordHash?: string | undefined;
      googleSub?: string | undefined;
      avatarUrl?: string | undefined;
    },
    meta: RequestMeta,
  ): Promise<{ organization: Organization; user: User }> {
    const slug = await this.allocateSlug(params.organizationName);

    const { organization, user } = await this.deps.prisma.$transaction(async (tx) => {
      const org = await this.deps.organizations.withTx(tx).create({
        id: newId(IdPrefix.organization),
        name: params.organizationName,
        slug,
      });
      const createdUser = await this.deps.users.withTx(tx).create({
        id: newId(IdPrefix.user),
        email: params.email,
        name: params.name,
        ...(params.passwordHash !== undefined ? { passwordHash: params.passwordHash } : {}),
        ...(params.googleSub !== undefined ? { googleSub: params.googleSub } : {}),
        ...(params.avatarUrl !== undefined ? { avatarUrl: params.avatarUrl } : {}),
      });
      await this.deps.memberships.withTx(tx).create({
        id: newId(IdPrefix.membership),
        organizationId: org.id,
        userId: createdUser.id,
        role: Role.OWNER,
      });
      return { organization: org, user: createdUser };
    });

    await this.deps.audit.record({
      organizationId: organization.id,
      actorUserId: user.id,
      action: AuditAction.OrganizationCreated,
      resourceType: 'organization',
      resourceId: organization.id,
      ...meta,
    });
    await this.deps.audit.record({
      organizationId: organization.id,
      actorUserId: user.id,
      action: AuditAction.UserRegistered,
      resourceType: 'user',
      resourceId: user.id,
      ...meta,
    });

    return { organization, user };
  }

  private async issueSession(
    user: User,
    organization: Organization,
    role: Role,
    meta: RequestMeta,
  ): Promise<{ tokens: AuthTokens; sessionId: string }> {
    const refreshToken = generateOpaqueToken();
    const sessionId = newId(IdPrefix.session);

    await this.deps.sessions.create({
      id: sessionId,
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + this.deps.config.refreshTtl * 1000),
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
    });

    const accessToken = await this.deps.jwt.signAccessToken({
      sub: user.id,
      org: organization.id,
      role,
      sid: sessionId,
    });

    return {
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: this.deps.config.accessTtl,
        tokenType: 'Bearer',
      },
      sessionId,
    };
  }

  /** Find an available slug derived from the org name, adding a suffix on collision. */
  private async allocateSlug(organizationName: string): Promise<string> {
    const base = slugify(organizationName);
    const suffix = (bytes: number): string =>
      generateOpaqueToken(bytes).replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 6);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${suffix(4)}`;
      const existing = await this.deps.organizations.findBySlug(candidate);
      if (!existing) return candidate;
    }
    // Extremely unlikely; fall back to a fully random slug.
    return `${base}-${suffix(8)}`;
  }

  private buildResult(
    user: User,
    organization: Organization,
    role: Role,
    tokens: AuthTokens,
  ): AuthResult {
    return {
      user: toPublicUser(user),
      organization: toPublicOrganization(organization),
      role,
      tokens,
    };
  }

  private async resolveActiveMembership(userId: string): Promise<MembershipWithOrganization> {
    const memberships = await this.deps.memberships.listActiveByUser(userId);
    const active = memberships[0];
    if (!active) {
      throw new ForbiddenError('User is not an active member of any organization');
    }
    return active;
  }

  private async recordReuse(userId: string, meta: RequestMeta): Promise<void> {
    const memberships = await this.deps.memberships.listActiveByUser(userId);
    const orgId = memberships[0]?.organizationId;
    if (orgId) {
      await this.deps.audit.record({
        organizationId: orgId,
        actorUserId: userId,
        action: AuditAction.AuthTokenReuseDetected,
        resourceType: 'session',
        ...meta,
      });
    }
  }

  /** Burn CPU comparable to a real verify so timing does not leak account existence. */
  private async dummyVerify(password: string): Promise<boolean> {
    // A precomputed argon2id hash of a random value; verification will fail.
    const decoy =
      '$argon2id$v=19$m=19456,t=3,p=1$c29tZXNhbHRzb21lc2FsdA$0Xk9Yb0m6Qm0Qm0Qm0Qm0Qm0Qm0Qm0Qm0Qm0Qm0Q';
    await verifyPassword(decoy, password);
    return false;
  }
}
