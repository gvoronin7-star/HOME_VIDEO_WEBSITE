import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // One process per file. Required, not a preference: `config` reads process.env
    // once at import time and the rate limiters are module-level singletons, so
    // files that need different environments must not share a module registry.
    isolate: true,
    pool: 'forks',
    // Renders, retries with backoff and spawning the real server are slow.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    setupFiles: ['tests/setup.ts'],
    // Runs in the main process after every worker exits — the only place the
    // scratch directories can actually be deleted.
    globalSetup: ['tests/globalTeardown.ts'],
    // Integration tests share a Redis-less port and temp directories.
    fileParallelism: false,
    reporters: ['default'],
  },
});
