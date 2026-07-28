import { defineConfig } from 'vitest/config';

/** Unit tests: fast, no external dependencies (DB/Redis are mocked). */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/main.ts', 'src/**/*.routes.ts'],
    },
  },
});
