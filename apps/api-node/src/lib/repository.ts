import type { Prisma, PrismaClient } from '@akp/db';

/** Either the root client or a transaction-scoped client. */
export type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Base for all repositories. Repositories are the ONLY place that touch Prisma,
 * keeping services persistence-agnostic and unit-testable. `withTx` rebinds a
 * repository to a transaction client so a service can compose multiple
 * repositories inside a single atomic `$transaction`.
 */
export abstract class BaseRepository<Self extends BaseRepository<Self>> {
  constructor(protected readonly db: DbClient) {}

  /** Return a copy of this repository bound to the given transaction client. */
  withTx(tx: Prisma.TransactionClient): Self {
    const Ctor = this.constructor as new (db: DbClient) => Self;
    return new Ctor(tx);
  }
}
