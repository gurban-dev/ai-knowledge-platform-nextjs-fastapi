import {
  ConflictError,
  type FieldEncryptor,
  MfaInvalidError,
  NotFoundError,
  ValidationError,
} from '@akp/core';
import type { User } from '@akp/db';
import type { Logger } from '@akp/observability';
import { hashToken, safeCompareHex } from '../../lib/crypto.js';
import {
  buildOtpauthUri,
  generateRecoveryCodes,
  generateTotpSecret,
  verifyTotp,
} from '../../lib/totp.js';
import type { UserRepository } from '../users/user.repository.js';
import { AuditAction, type AuditService } from '../audit/audit.service.js';
import type { RequestMeta } from '../auth/auth.types.js';

export interface MfaServiceDeps {
  users: UserRepository;
  encryptor: FieldEncryptor;
  audit: AuditService;
  logger: Logger;
  issuer: string;
}

export interface EnrollmentResult {
  secret: string;
  otpauthUri: string;
}

export interface MfaStatus {
  enabled: boolean;
  verifiedAt: string | null;
  recoveryCodesRemaining: number;
}

/**
 * TOTP-based multi-factor authentication. The shared secret is stored only in
 * envelope-encrypted form; recovery codes are stored as SHA-256 hashes and are
 * single-use. Enrollment is two-phase: generate a secret, then confirm the user
 * can produce a valid code before MFA is actually enforced.
 */
export class MfaService {
  constructor(private readonly deps: MfaServiceDeps) {}

  async status(userId: string): Promise<MfaStatus> {
    const user = await this.getUser(userId);
    return {
      enabled: user.mfaEnabled,
      verifiedAt: user.mfaVerifiedAt?.toISOString() ?? null,
      recoveryCodesRemaining: user.mfaRecoveryCodes.length,
    };
  }

  /** Phase 1: create (or replace) an unconfirmed secret. */
  async beginEnrollment(userId: string, organizationId: string, meta: RequestMeta): Promise<EnrollmentResult> {
    const user = await this.getUser(userId);
    if (user.mfaEnabled) {
      throw new ConflictError('MFA is already enabled; disable it before re-enrolling');
    }
    const secret = generateTotpSecret();
    await this.deps.users.update(userId, {
      mfaSecret: this.deps.encryptor.encrypt(secret),
      mfaEnabled: false,
      mfaVerifiedAt: null,
      mfaRecoveryCodes: [],
    });
    await this.deps.audit.record({
      organizationId,
      actorUserId: userId,
      action: AuditAction.MfaEnrollmentStarted,
      resourceType: 'user',
      resourceId: userId,
      ...meta,
    });
    return {
      secret,
      otpauthUri: buildOtpauthUri({
        secretBase32: secret,
        issuer: this.deps.issuer,
        account: user.email,
      }),
    };
  }

  /** Phase 2: confirm a code and enable MFA, returning one-time recovery codes. */
  async activate(
    userId: string,
    organizationId: string,
    token: string,
    meta: RequestMeta,
  ): Promise<{ recoveryCodes: string[] }> {
    const user = await this.getUser(userId);
    if (user.mfaEnabled) {
      throw new ConflictError('MFA is already enabled');
    }
    if (!user.mfaSecret) {
      throw new ValidationError('Start MFA enrollment before activating');
    }
    const secret = this.deps.encryptor.decrypt(user.mfaSecret);
    if (!verifyTotp(secret, token)) {
      throw new MfaInvalidError();
    }
    const recoveryCodes = generateRecoveryCodes();
    await this.deps.users.update(userId, {
      mfaEnabled: true,
      mfaVerifiedAt: new Date(),
      mfaRecoveryCodes: recoveryCodes.map(hashToken),
    });
    await this.deps.audit.record({
      organizationId,
      actorUserId: userId,
      action: AuditAction.MfaEnabled,
      resourceType: 'user',
      resourceId: userId,
      ...meta,
    });
    this.deps.logger.info({ userId }, 'MFA enabled');
    return { recoveryCodes };
  }

  /** Disable MFA after verifying a current factor (code or recovery code). */
  async disable(
    userId: string,
    organizationId: string,
    factor: { token?: string | undefined; recoveryCode?: string | undefined },
    meta: RequestMeta,
  ): Promise<void> {
    const user = await this.getUser(userId);
    if (!user.mfaEnabled) return;
    await this.assertFactor(user, factor);
    await this.deps.users.update(userId, {
      mfaEnabled: false,
      mfaSecret: null,
      mfaVerifiedAt: null,
      mfaRecoveryCodes: [],
    });
    await this.deps.audit.record({
      organizationId,
      actorUserId: userId,
      action: AuditAction.MfaDisabled,
      resourceType: 'user',
      resourceId: userId,
      ...meta,
    });
    this.deps.logger.info({ userId }, 'MFA disabled');
  }

  /** Issue a fresh set of recovery codes (invalidates the previous set). */
  async regenerateRecoveryCodes(
    userId: string,
    token: string,
  ): Promise<{ recoveryCodes: string[] }> {
    const user = await this.getUser(userId);
    if (!user.mfaEnabled) throw new ValidationError('MFA is not enabled');
    await this.assertFactor(user, { token });
    const recoveryCodes = generateRecoveryCodes();
    await this.deps.users.update(userId, {
      mfaRecoveryCodes: recoveryCodes.map(hashToken),
    });
    return { recoveryCodes };
  }

  /**
   * Validate an MFA factor during login. Consumes a recovery code if one is used.
   * Throws {@link MfaInvalidError} when neither a valid TOTP nor recovery code is
   * supplied.
   */
  async verifyForLogin(
    user: User,
    factor: { token?: string | undefined; recoveryCode?: string | undefined },
  ): Promise<void> {
    await this.assertFactor(user, factor);
  }

  private async assertFactor(
    user: User,
    factor: { token?: string | undefined; recoveryCode?: string | undefined },
  ): Promise<void> {
    if (factor.token && user.mfaSecret) {
      const secret = this.deps.encryptor.decrypt(user.mfaSecret);
      if (verifyTotp(secret, factor.token)) return;
    }
    if (factor.recoveryCode) {
      const hashed = hashToken(factor.recoveryCode.trim());
      const match = user.mfaRecoveryCodes.find((code) => safeCompareHex(code, hashed));
      if (match) {
        // Single-use: remove the consumed recovery code.
        await this.deps.users.update(user.id, {
          mfaRecoveryCodes: user.mfaRecoveryCodes.filter((code) => code !== match),
        });
        return;
      }
    }
    throw new MfaInvalidError();
  }

  private async getUser(userId: string): Promise<User> {
    const user = await this.deps.users.findById(userId);
    if (!user) throw new NotFoundError('User');
    return user;
  }
}
