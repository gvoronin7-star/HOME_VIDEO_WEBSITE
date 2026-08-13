import multer from 'multer';
import { Request } from 'express';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { AppError } from './error.middleware';

type FileType = 'photos' | 'audio';

/**
 * Disk, not memory: `memoryStorage()` buffered up to `maxFileSizeMB * maxPhotos`
 * (200 MB by default) per request entirely in the Node heap, so a handful of
 * concurrent uploads could exhaust the process's memory. `diskStorage` streams
 * each file straight to disk in small chunks — per-request memory use stays
 * roughly constant regardless of file size or count.
 *
 * Written into the same `temp/` directory the render pipeline scratch files use,
 * so `storageService.cleanupTempFiles()` (the retention sweep) also catches any
 * upload left behind by a request that never finished. Callers still delete
 * their own temp file immediately after use — the sweep is a backstop, not the
 * primary cleanup path.
 */
const uploadTempDir = path.resolve(config.storage.path, 'temp');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdir(uploadTempDir, { recursive: true }, (err) => cb(err, uploadTempDir));
  },
  filename: (req, file, cb) => {
    cb(null, `upload-${uuidv4()}${path.extname(file.originalname)}`);
  },
});

const createFileFilter = (type: FileType) => {
  return (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    if (type === 'photos') {
      const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
      if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new AppError('Недопустимый формат файла. Разрешены: JPG, PNG, WebP', 422));
      }
    } else if (type === 'audio') {
      const allowedMimes = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm'];
      if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new AppError('Недопустимый формат аудио. Разрешены: MP3, WAV, OGG', 422));
      }
    } else {
      cb(new AppError('Неизвестный тип файла', 422));
    }
  };
};

export const uploadPhotos = multer({
  storage,
  limits: {
    fileSize: config.limits.maxFileSizeMB * 1024 * 1024,
    files: config.limits.maxPhotos,
  },
  fileFilter: createFileFilter('photos'),
});

export const uploadAudio = multer({
  storage,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20 MB for audio
    files: 1,
  },
  fileFilter: createFileFilter('audio'),
});
