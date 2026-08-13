import { createApp } from './app';
import { config } from './config';
import { logger } from './utils/logger';
import sequelize from './models/sequelize';
import './models'; // Import associations
import { validateSecurityConfig } from './utils/validateConfig';
import { startRetentionSchedule } from './services/retention.service';

/** Tables the application cannot serve a single request without. */
const REQUIRED_TABLES = [
  'users',
  'stories',
  'story_slides',
  'templates',
  'voice_profiles',
  'tasks',
];

/**
 * Outside development nothing creates the schema — there are no versioned
 * migrations yet, so it is initialised by an explicit deploy step
 * (`node dist/utils/migrate.js`, run by the `init` service in docker-compose).
 * If that step was skipped the server would previously start and pass its
 * health check, then fail on the first request touching data. Fail loudly here
 * instead.
 */
async function assertSchemaPresent(): Promise<void> {
  const existing = (await sequelize.getQueryInterface().showAllTables()).map((table) =>
    String(table).toLowerCase(),
  );
  const missing = REQUIRED_TABLES.filter((table) => !existing.includes(table));

  if (missing.length > 0) {
    logger.fatal(
      { missing },
      'Схема БД не инициализирована. Выполните "node dist/utils/migrate.js" (или "npm run migrate") перед запуском сервера',
    );
    process.exit(1);
  }
}

async function start() {
  try {
    // Before anything else: refuse to serve production traffic with a known secret.
    validateSecurityConfig();

    // Connect to database
    await sequelize.authenticate();
    logger.info('Database connection established');

    if (config.server.nodeEnv === 'development') {
      await sequelize.sync({ alter: false });
      logger.info('Database models synchronized');
    } else {
      await assertSchemaPresent();
      logger.info('Database schema verified');
    }

    // The BullMQ job consumer runs as its own process (`worker:prod` /
    // workers/render.worker.ts), not here — the API process no longer starts
    // it itself, so the render pipeline's CPU and crash blast radius stay
    // separate from request handling. See docker-compose.yml's `worker` service.

    // Enforce the retention policy. Runs in the API process only, so a scaled-out
    // worker fleet cannot sweep concurrently.
    startRetentionSchedule();

    const app = createApp();

    app.listen(config.server.port, () => {
      logger.info(`Server running on port ${config.server.port}`);
      logger.info(`Environment: ${config.server.nodeEnv}`);
      logger.info(`CORS origin: ${config.server.corsOrigin}`);
    });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to start server');
    process.exit(1);
  }
}

start();
