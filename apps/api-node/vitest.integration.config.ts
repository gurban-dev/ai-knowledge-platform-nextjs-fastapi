import { defineConfig } from 'vitest/config';

/**
 * Integration tests: exercise the real Fastify app against a real Postgres +
 * Redis. They self-skip when TEST_DATABASE_URL is not set so unit runs and
 * fresh checkouts stay green.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Integration tests share a database; run serially to avoid cross-talk.
    fileParallelism: false,
  },
});
