import sequelize from '../models/sequelize';
import '../models'; // Register models and associations before syncing
import { logger } from './logger';
import { umzug } from '../migrations/runner';

/**
 * Schema initialisation. Runs as an explicit deploy step and must be safe to
 * repeat.
 *
 * Two mechanisms, in order, for two different jobs:
 * - `sequelize.sync()` creates tables that don't exist yet. Safe to repeat,
 *   but it never alters an existing table — `alter: true` rewrites live
 *   columns and fails on repeat runs against PostgreSQL ENUM types.
 * - `umzug.up()` (src/migrations/) applies versioned changes to tables that
 *   already exist, tracked in a `SequelizeMeta` table so each migration runs
 *   at most once. This is what changing an existing column now uses.
 */
async function migrate() {
  try {
    await sequelize.authenticate();
    logger.info('Database connected');

    await sequelize.sync();
    logger.info('Schema initialised - all tables present');

    const applied = await umzug.up();
    logger.info({ applied: applied.map((m) => m.name) }, 'Versioned migrations applied');

    process.exit(0);
  } catch (error: any) {
    logger.error({ error: error.message }, 'Migration failed');
    process.exit(1);
  }
}

migrate();
