import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Environment defaults applied before any application module is imported.
 *
 * `src/config` snapshots process.env at import time, so anything a test needs to
 * change must be set here or at the very top of the test file — never inside a
 * test body after the app has been imported.
 */

// A per-run scratch directory keeps databases and uploads out of the repository.
const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'family-cinema-tests-'));

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';

process.env.DB_DIALECT = 'sqlite';
process.env.DB_STORAGE = path.join(runRoot, 'test.sqlite');
process.env.STORAGE_PATH = path.join(runRoot, 'uploads');

// 32+ characters: the production startup guard rejects anything weaker, and tests
// should exercise the same shape of secret real deployments use.
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-Q7pX2vZ9mK4rT8wY6nB3jL5hF1dS0aG';

// Nothing listens here. Tests that care about the queue assert on the failure.
process.env.REDIS_HOST = '127.0.0.1';
process.env.REDIS_PORT = '6399';

// No outbound calls unless a test explicitly points these at a local stub.
process.env.OPENAI_API_KEY = '';
process.env.OPENAI_BASE_URL = '';
process.env.TTS_SERVICE = 'none';

process.env.PUBLIC_URL = 'http://localhost:3000';
process.env.CORS_ORIGIN = 'http://localhost:3000';

// Removal happens in tests/globalTeardown.ts: these directories are created inside
// worker processes, which Vitest terminates without running exit handlers, and the
// SQLite handle is still open at that point on Windows.
export const TEST_RUN_ROOT = runRoot;
