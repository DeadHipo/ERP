import { defineConfig } from 'vitest/config';

// Only the pure helpers and the guard tests run here; the browser specs are in e2e/ (Playwright).
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
