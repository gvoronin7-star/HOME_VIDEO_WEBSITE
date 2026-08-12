import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Finding S2: `dev-secret-key` is published in this repository, so a deployment
 * that fell back to it was wide open while looking perfectly healthy. The guard
 * lives in the real startup path, so it is exercised by launching the compiled
 * server rather than by calling a function.
 */

const BACKEND_ROOT = path.resolve(__dirname, '..');
const STRONG_SECRET = 'K7pQ2vX9mZ4rT8wY6nB3jL5hF1dS0aG7cV2uE9iO4kP6';

let dbPath: string;
let uploadsPath: string;

interface StartResult {
  exitedWithError: boolean;
  keptRunning: boolean;
  output: string;
}

function startServer(env: { NODE_ENV: string; JWT_SECRET: string }): StartResult {
  try {
    const output = execFileSync(process.execPath, ['dist/server.js'], {
      cwd: BACKEND_ROOT,
      timeout: 15_000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_ENV: env.NODE_ENV,
        JWT_SECRET: env.JWT_SECRET,
        LOG_LEVEL: 'info',
        DB_DIALECT: 'sqlite',
        DB_STORAGE: dbPath,
        STORAGE_PATH: uploadsPath,
        REDIS_PORT: '6399',
        OPENAI_API_KEY: '',
        PORT: '4199',
      },
    });
    return { exitedWithError: false, keptRunning: true, output };
  } catch (error: any) {
    const output = String((error.stdout ?? '') + (error.stderr ?? ''));
    // A clean refusal exits 1; a healthy server is killed by the timeout instead.
    return { exitedWithError: error.status === 1, keptRunning: error.signal != null, output };
  }
}

beforeAll(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'family-cinema-startup-'));
  dbPath = path.join(root, 'startup.sqlite');
  uploadsPath = path.join(root, 'uploads');

  // The compiled output is what production runs, so build before asserting on it.
  execFileSync('npm', ['run', 'build'], { cwd: BACKEND_ROOT, stdio: 'ignore', shell: true });

  // A schema must exist, otherwise the *schema* guard fires and masks this one.
  execFileSync(process.execPath, ['dist/utils/migrate.js'], {
    cwd: BACKEND_ROOT,
    stdio: 'ignore',
    timeout: 60_000,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      JWT_SECRET: STRONG_SECRET,
      LOG_LEVEL: 'silent',
      DB_DIALECT: 'sqlite',
      DB_STORAGE: dbPath,
      STORAGE_PATH: uploadsPath,
      REDIS_PORT: '6399',
    },
  });
}, 180_000);

describe('production startup guard (S2)', () => {
  it.each([
    ['the published default', 'dev-secret-key'],
    ['an empty secret', ''],
    ['a secret shorter than 32 characters', 'short-secret'],
    ['the .env.example placeholder', 'your-super-secret-jwt-key-change-in-production'],
  ])('refuses to start in production with %s', (_label, secret) => {
    const result = startServer({ NODE_ENV: 'production', JWT_SECRET: secret });

    expect(result.exitedWithError).toBe(true);
    expect(result.output).toMatch(/JWT_SECRET/);
  });

  it('starts in production with a strong secret', () => {
    const result = startServer({ NODE_ENV: 'production', JWT_SECRET: STRONG_SECRET });
    expect(result.keptRunning).toBe(true);
  });

  it('still runs in development with the default, but warns', () => {
    // Local work should not need ceremony; silence would be the problem.
    const result = startServer({ NODE_ENV: 'development', JWT_SECRET: 'dev-secret-key' });

    expect(result.keptRunning).toBe(true);
    expect(result.output).toMatch(/Небезопасная конфигурация/);
  });
});

describe('schema guard (B5)', () => {
  it('refuses to serve production traffic on a missing schema', () => {
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'family-cinema-empty-'));
    const emptyDb = path.join(emptyRoot, 'empty.sqlite');

    let result: StartResult;
    try {
      const output = execFileSync(process.execPath, ['dist/server.js'], {
        cwd: BACKEND_ROOT,
        timeout: 15_000,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          NODE_ENV: 'production',
          JWT_SECRET: STRONG_SECRET,
          LOG_LEVEL: 'info',
          DB_DIALECT: 'sqlite',
          DB_STORAGE: emptyDb,
          STORAGE_PATH: uploadsPath,
          REDIS_PORT: '6399',
          PORT: '4198',
        },
      });
      result = { exitedWithError: false, keptRunning: true, output };
    } catch (error: any) {
      result = {
        exitedWithError: error.status === 1,
        keptRunning: error.signal != null,
        output: String((error.stdout ?? '') + (error.stderr ?? '')),
      };
    }

    // Previously the server started, passed its health check and only failed on
    // the first request that touched data.
    expect(result.exitedWithError).toBe(true);
    expect(result.output).toMatch(/Схема БД не инициализирована/);
  });
});
