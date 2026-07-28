import type { PrismaClient } from '@akp/db';

/**
 * Run `fn` inside a transaction with Postgres RLS tenant context set.
 * Policies allow access when `app.current_org_id` matches `organization_id`,
 * or when the GUC is unset (migrations/admin). Always set it for request paths.
 */
export async function withTenant<T>(
  prisma: PrismaClient,
  organizationId: string,
  fn: (
    tx: Omit<
      PrismaClient,
      '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
    >,
  ) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`;
    return fn(tx);
  });
}
