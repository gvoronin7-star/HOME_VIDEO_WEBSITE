import { config } from '../config';
import { logger } from '../utils/logger';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export class StorageService {
  private basePath: string;

  constructor() {
    this.basePath = path.resolve(config.storage.path);
    this.ensureDirectories();
  }

  private async ensureDirectories() {
    const dirs = ['photos', 'videos', 'pdfs', 'qrcodes', 'audio', 'temp'];
    for (const dir of dirs) {
      await fs.mkdir(path.join(this.basePath, dir), { recursive: true });
    }
  }

  /**
   * Save a file to local storage.
   */
  async saveFile(
    buffer: Buffer,
    originalName: string,
    category: 'photos' | 'videos' | 'pdfs' | 'qrcodes' | 'audio' | 'temp',
  ): Promise<{ url: string; key: string }> {
    const ext = path.extname(originalName) || '.jpg';
    const key = `${uuidv4()}${ext}`;
    const filePath = path.join(this.basePath, category, key);

    await fs.writeFile(filePath, buffer);
    logger.info({ category, key }, 'File saved to local storage');

    const url = `/uploads/${category}/${key}`;
    return { url, key: `${category}/${key}` };
  }

  /**
   * Get the absolute path of a stored file.
   */
  getFilePath(key: string): string {
    return path.join(this.basePath, this.keyFromUrl(key));
  }

  /**
   * Normalise a public URL into a storage key.
   *
   * The database stores public URLs (`/uploads/videos/x.mp4`) for videos, PDFs and
   * QR codes, but storage keys (`videos/x.mp4`) for slide images. Passing a URL
   * where a key was expected produced `uploads/uploads/videos/x.mp4`, whose ENOENT
   * was then swallowed — which is why videos and PDFs were never actually deleted.
   * Accepting both forms removes that trap.
   */
  keyFromUrl(urlOrKey: string): string {
    return urlOrKey.replace(/^\/+/, '').replace(/^uploads\//, '');
  }

  /**
   * Delete a file. Accepts either a storage key or a public `/uploads/...` URL.
   *
   * @param options.missingOk pass true for artefacts that legitimately may not
   *   exist (an optional preview). Otherwise a missing file is reported, because
   *   silently swallowing ENOENT is what hid finding C1.
   */
  async deleteFile(keyOrUrl: string, options: { missingOk?: boolean } = {}): Promise<void> {
    const key = this.keyFromUrl(keyOrUrl);

    try {
      await fs.unlink(path.join(this.basePath, key));
      logger.info({ key }, 'File deleted');
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        if (!options.missingOk) {
          logger.warn({ key }, 'File to delete was not found');
        }
      } else {
        logger.error({ error: error.message, key }, 'Failed to delete file');
      }
    }
  }

  /**
   * Remove leftovers from the render temp directory.
   *
   * Scoped to `temp` on purpose. An earlier version of this method swept every
   * category by modification time, including `photos` — which would have deleted
   * the images of stories that still exist, leaving rows pointing at nothing.
   * Files belonging to a story are removed by expiring the story itself
   * (see retention.service.ts).
   */
  async cleanupTempFiles(maxAgeHours = 24): Promise<number> {
    const tempPath = path.join(this.basePath, 'temp');
    const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
    let removed = 0;

    try {
      const entries = await fs.readdir(tempPath, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = path.join(tempPath, entry.name);
        try {
          const stat = await fs.stat(entryPath);
          if (stat.mtimeMs > cutoff) continue;

          // Render scratch space is a directory per job.
          await fs.rm(entryPath, { recursive: true, force: true });
          removed += 1;
        } catch (error: any) {
          if (error.code !== 'ENOENT') {
            logger.warn({ error: error.message, entry: entry.name }, 'Could not remove temp entry');
          }
        }
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        logger.error({ error: error.message }, 'Error sweeping the temp directory');
      }
    }

    return removed;
  }

  /**
   * Generate a URL for a file.
   */
  getFileUrl(key: string): string {
    // In production, this would be a full URL
    return `/uploads/${key}`;
  }
}

export const storageService = new StorageService();
