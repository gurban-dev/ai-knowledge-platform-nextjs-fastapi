import type { Session } from '@akp/db';
import { BaseRepository } from '../../lib/repository.js';

export interface CreateSessionInput {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
}

/**
 * Refresh-token sessions. Each row represents one issued refresh token (stored
 * as a SHA-256 hash). Rotation creates a new row and marks the old one revoked
 * + `replacedById`, enabling refresh-token reuse detection.
 */
export class SessionRepository extends BaseRepository<SessionRepository> {
  async create(input: CreateSessionInput): Promise<Session> {
    return this.db.session.create({
      data: {
        id: input.id,
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        userAgent: input.userAgent ?? null,
        ipAddress: input.ipAddress ?? null,
      },
    });
  }

  async findByTokenHash(tokenHash: string): Promise<Session | null> {
    return this.db.session.findUnique({ where: { tokenHash } });
  }

  async revoke(id: string, replacedById?: string): Promise<void> {
    await this.db.session.update({
      where: { id },
      data: { revokedAt: new Date(), replacedById: replacedById ?? null },
    });
  }

  /** Revoke every active session for a user (logout-all / credential change). */
  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.db.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }
}
