import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    setupFiles: ['tests/setup.ts'],
    // D-189: the tests pin the default source; a test that needs v2 opens its facade with `publishingSource: 'v2'`
    env: { PUBLISHING_SOURCE: 'v1' },
  },
});
