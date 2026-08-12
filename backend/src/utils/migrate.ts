import sequelize from '../models/sequelize';
import '../models'; // Register models and associations before syncing
import { logger } from './logger';

/**
 * Schema initialisation. Runs as an explicit deploy step and must be safe to
 * repeat, so it only creates missing tables and never alters existing ones —
 * `alter: true` rewrites live columns and fails on repeat runs against
 * PostgreSQL ENUM types.
 *
 * NOTE: this is not a migration system. Changes to existing columns still
 * require versioned migrations (see PROPOSALS.md).
 */
async function migrate() {
  try {
    await sequelize.authenticate();
    logger.info('Database connected');

    await sequelize.sync();
    logger.info('Schema initialised - all tables present');

    process.exit(0);
  } catch (error: any) {
    logger.error({ error: error.message }, 'Migration failed');
    process.exit(1);
  }
}

migrate();