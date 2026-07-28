import type { Prisma, User } from '@akp/db';
import { BaseRepository } from '../../lib/repository.js';

export interface CreateUserInput {
  id: string;
  email: string;
  name: string;
  /** Omitted for federated (e.g. Google) accounts that never set a password. */
  passwordHash?: string | undefined;
  /** Google OAuth subject, set when the account is created via Google. */
  googleSub?: string | undefined;
  avatarUrl?: string | undefined;
}

/** Data access for the global `users` identity table. */
export class UserRepository extends BaseRepository<UserRepository> {
  async findById(id: string): Promise<User | null> {
    return this.db.user.findUnique({ where: { id } });
  }

  /** Emails are stored/compared case-insensitively (normalized to lower-case). */
  async findByEmail(email: string): Promise<User | null> {
    return this.db.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  /** Look up a user by their linked Google OAuth subject. */
  async findByGoogleSub(googleSub: string): Promise<User | null> {
    return this.db.user.findUnique({ where: { googleSub } });
  }

  async create(input: CreateUserInput): Promise<User> {
    return this.db.user.create({
      data: {
        id: input.id,
        email: input.email.toLowerCase(),
        name: input.name,
        ...(input.passwordHash !== undefined ? { passwordHash: input.passwordHash } : {}),
        ...(input.googleSub !== undefined ? { googleSub: input.googleSub } : {}),
        ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
      },
    });
  }

  /** Link an existing account to a Google subject (first Google sign-in). */
  async linkGoogleSub(id: string, googleSub: string): Promise<User> {
    return this.db.user.update({ where: { id }, data: { googleSub } });
  }

  async touchLastLogin(id: string, at: Date = new Date()): Promise<void> {
    await this.db.user.update({ where: { id }, data: { lastLoginAt: at } });
  }

  async update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return this.db.user.update({ where: { id }, data });
  }
}
