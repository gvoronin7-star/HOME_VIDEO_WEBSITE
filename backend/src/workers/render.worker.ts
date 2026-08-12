import { getWorker } from '../queues/generationQueue';
import { logger } from '../utils/logger';

/**
 * Render worker - starts the BullMQ worker for processing story generation tasks.
 * Uses lazy-loaded worker to avoid crash when Redis is unavailable.
 */
export function startWorker() {
  logger.info('BullMQ generation worker starting...');

  const worker = getWorker();

  if (!worker) {
    logger.warn('BullMQ worker could not be created (Redis may be unavailable)');
    return;
  }

  logger.info('BullMQ generation worker is listening for jobs');
}

// Run directly if called as standalone worker process
if (require.main === module) {
  startWorker();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down worker gracefully...`);
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

export default startWorker;