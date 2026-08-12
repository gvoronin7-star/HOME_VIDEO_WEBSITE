import multer from 'multer';
import path from 'path';
import { Request } from 'express';
import { config } from '../config';
import { AppError } from './error.middleware';

type FileType = 'photos' | 'audio';

const storage = multer.memoryStorage();

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