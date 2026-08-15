import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DataTypes, Sequelize } from 'sequelize';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Migration 0001 adds `stories.shareToken` as a UNIQUE column. `sequelize.sync()`
 * only ever creates missing tables, so every other test in this suite runs
 * against a brand-new SQLite file where `shareToken` already exists as part of
 * the current model — this migration's actual ALTER TABLE path never executes.
 * It only runs for real against a database that predates the column, which is
 * exactly what this test simulates: a `stories` table created without it.
 *
 * SQLite's `ALTER TABLE ... ADD COLUMN` rejects a column-level UNIQUE outright
 * ("Cannot add a UNIQUE column"), unlike Postgres — a restriction invisible to
 * both CI (Postgres-only) and every fresh-database test, caught only by running
 * this migration against a real pre-existing SQLite file.
 */

const BACKEND_ROOT = path.resolve(__dirname, '..');
const STRONG_SECRET = 'K7pQ2vX9mZ4rT8wY6nB3jL5hF1dS0aG7cV2uE9iO4kP6';

let dbPath: string;
let uploadsPath: string;

beforeAll(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'family-cinema-migration-'));
  dbPath = path.join(root, 'legacy.sqlite');
  uploadsPath = path.join(root, 'uploads');

  execFileSync('npm', ['run', 'build'], { cwd: BACKEND_ROOT, stdio: 'ignore', shell: true });

  const seed = new Sequelize({ dialect: 'sqlite', storage: dbPath, logging: false });
  await seed.getQueryInterface().createTable('stories', {
    id: { type: DataTypes.UUID, primaryKey: true },
    userId: { type: DataTypes.UUID, allowNull: false },
    title: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false },
  });
  await seed.close();
}, 120_000);

describe('migration 0001-add-story-share-token against a pre-existing SQLite database', () => {
  it('adds the column and enforces uniqueness via a separate index, instead of failing on ADD COLUMN UNIQUE', () => {
    expect(() =>
      execFileSync(process.execPath, ['dist/utils/migrate.js'], {
        cwd: BACKEND_ROOT,
        stdio: 'pipe',
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
          OPENAI_API_KEY: '',
        },
      }),
    ).not.toThrow();
  });

  it('actually enforces uniqueness on the new column, not just adds it', async () => {
    const db = new Sequelize({ dialect: 'sqlite', storage: dbPath, logging: false });

    await db
      .getQueryInterface()
      .bulkInsert('stories', [
        {
          id: 'story-a',
          userId: 'user-a',
          title: 'A',
          status: 'ready',
          shareToken: 'token-shared',
        },
      ]);

    let rejection: any;
    try {
      await db
        .getQueryInterface()
        .bulkInsert('stories', [
          {
            id: 'story-b',
            userId: 'user-b',
            title: 'B',
            status: 'ready',
            shareToken: 'token-shared',
          },
        ]);
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toBeDefined();
    expect(String(rejection?.original?.message ?? rejection?.message)).toMatch(/unique/i);

    await db.close();
  });
});

describe('migration 0002-add-performance-indexes', () => {
  it('adds stories/story_slides/tasks indexes to the same pre-existing database', async () => {
    // The previous describe block already ran migrate.js against dbPath once,
    // applying both 0001 and 0002 in the same pass — this asserts 0002 actually
    // created what it claims to.
    const db = new Sequelize({ dialect: 'sqlite', storage: dbPath, logging: false });

    const storiesIndexes = await db.getQueryInterface().showIndex('stories');
    const names = (storiesIndexes as Array<{ name: string }>).map((idx) => idx.name);
    expect(names).toContain('stories_user_id_idx');
    expect(names).toContain('stories_status_idx');

    await db.close();
  });

  it('is a no-op on a brand-new database, where sync() already created the same indexes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'family-cinema-migration-fresh-'));
    const freshDb = path.join(root, 'fresh.sqlite');
    const freshUploads = path.join(root, 'uploads');

    // No pre-seeded table here: sync() creates `stories`/`story_slides`/`tasks`
    // from the current model definitions, indexes included, before either
    // migration's `up()` runs — this is the idempotency path every fresh
    // dev/Docker database takes, and where a naive unconditional addIndex
    // would fail exactly like migration 0001's unconditional addColumn did.
    expect(() =>
      execFileSync(process.execPath, ['dist/utils/migrate.js'], {
        cwd: BACKEND_ROOT,
        stdio: 'pipe',
        timeout: 60_000,
        env: {
          ...process.env,
          NODE_ENV: 'development',
          JWT_SECRET: STRONG_SECRET,
          LOG_LEVEL: 'silent',
          DB_DIALECT: 'sqlite',
          DB_STORAGE: freshDb,
          STORAGE_PATH: freshUploads,
          REDIS_PORT: '6399',
          OPENAI_API_KEY: '',
        },
      }),
    ).not.toThrow();
  });
});
