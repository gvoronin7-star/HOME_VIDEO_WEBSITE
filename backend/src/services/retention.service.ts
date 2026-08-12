import { Op } from 'sequelize';
import { Story, StorySlide } from '../models';
import { storageService } from './storage.service';
import { collectStoryArtefacts } from '../utils/storyArtefacts';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Retention policy: stories and their files are removed once they pass the age in
 * `FILE_RETENTION_DAYS`.
 *
 * The ТЗ asks for files to be deleted after a period, and the method to do it had
 * existed since the first version — but nothing ever called it, so family photos
 * were kept indefinitely, contradicting the stated privacy policy.
 *
 * Whole stories are expired rather than loose files. Deleting files by age alone
 * would leave rows referencing images that no longer exist, turning a privacy
 * feature into a source of broken stories.
 */

let sweepTimer: NodeJS.Timeout | null = null;
let sweepInProgress = false;

export interface RetentionResult {
  expiredStories: number;
  deletedFiles: number;
  removedTempEntries: number;
}

/** Delete one story with every file it owns. */
async function deleteStoryWithFiles(story: any): Promise<number> {
  const { required, optional } = collectStoryArtefacts(story);

  for (const key of required) {
    await storageService.deleteFile(key);
  }
  for (const key of optional) {
    await storageService.deleteFile(key, { missingOk: true });
  }

  await story.destroy();

  return required.length;
}

/**
 * Expire everything older than the retention window.
 *
 * Exported so it can be triggered on demand and asserted in tests, rather than
 * only firing on a timer nobody can observe.
 */
export async function runRetentionSweep(
  retentionDays: number = config.retention.fileDays
): Promise<RetentionResult> {
  const result: RetentionResult = { expiredStories: 0, deletedFiles: 0, removedTempEntries: 0 };

  // Render scratch space is never referenced by a row, so it can always go.
  result.removedTempEntries = await storageService.cleanupTempFiles();

  if (!retentionDays || retentionDays <= 0) {
    logger.info('Retention is disabled (FILE_RETENTION_DAYS is 0) — only temp files swept');
    return result;
  }

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const expired = await Story.findAll({
    where: { createdAt: { [Op.lt]: cutoff } },
    include: [{ model: StorySlide, as: 'slides' }],
  });

  for (const story of expired) {
    try {
      result.deletedFiles += await deleteStoryWithFiles(story);
      result.expiredStories += 1;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      // One bad story must not abort the whole sweep.
      logger.error({ storyId: story.id, error: message }, 'Retention: failed to expire story');
    }
  }

  logger.info(
    { ...result, retentionDays, cutoff: cutoff.toISOString() },
    'Retention sweep completed'
  );

  return result;
}

/**
 * Start the periodic sweep. Called once from the API process.
 *
 * An interval rather than a repeatable queue job: this must keep working when
 * Redis is unavailable, which is precisely when leftovers pile up fastest.
 */
export function startRetentionSchedule(): void {
  if (sweepTimer) return;

  const intervalHours = config.retention.sweepHours;
  if (intervalHours <= 0) {
    logger.info('Retention schedule disabled (RETENTION_SWEEP_HOURS is 0)');
    return;
  }

  const run = async () => {
    if (sweepInProgress) {
      logger.warn('Retention: previous sweep still running, skipping this tick');
      return;
    }

    sweepInProgress = true;
    try {
      await runRetentionSweep();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: message }, 'Retention sweep failed');
    } finally {
      sweepInProgress = false;
    }
  };

  sweepTimer = setInterval(run, intervalHours * 60 * 60 * 1000);
  // Do not hold the process open on account of the cleanup timer.
  sweepTimer.unref();

  logger.info(
    { intervalHours, retentionDays: config.retention.fileDays },
    'Retention schedule started'
  );

  // Once shortly after boot: a container that restarts often would otherwise never
  // reach the first interval.
  const initial = setTimeout(run, 60_000);
  initial.unref();
}

/** Stop the schedule (used by tests and graceful shutdown). */
export function stopRetentionSchedule(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
