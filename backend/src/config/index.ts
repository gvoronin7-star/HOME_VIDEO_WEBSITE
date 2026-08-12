import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  server: {
    port: parseInt(process.env.PORT || '4000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    // Origin where the frontend is served. Public share links and QR codes point
    // here, not at the API — `/share/:id` is a client-side route, so pointing it
    // at the backend yields a 404. Kept separate from CORS_ORIGIN, which is a
    // list of permitted request origins and may hold several values.
    // Trailing slashes are stripped so `${publicUrl}/share/x` never doubles up.
    publicUrl: (process.env.PUBLIC_URL || 'http://localhost:5173').replace(/\/+$/, ''),
  },
  database: {
    dialect: (process.env.DB_DIALECT || 'sqlite') as 'sqlite' | 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    name: process.env.DB_NAME || 'family_cinema',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    storage: process.env.DB_STORAGE || './database.sqlite',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-key',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  storage: {
    type: (process.env.STORAGE_TYPE || 'local') as 'local' | 's3',
    path: process.env.STORAGE_PATH || './uploads',
    s3: {
      endpoint: process.env.S3_ENDPOINT || '',
      bucket: process.env.S3_BUCKET || '',
      accessKey: process.env.S3_ACCESS_KEY || '',
      secretKey: process.env.S3_SECRET_KEY || '',
      region: process.env.S3_REGION || 'ru-1',
    },
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    // Base URL for an OpenAI-compatible endpoint. Empty = official OpenAI.
    // ProxyAPI: https://api.proxyapi.ru/openai/v1 — the API matches the official
    // specification, so the same SDK, key and base URL serve both the script
    // (chat/completions) and the narration (audio/speech).
    baseUrl: process.env.OPENAI_BASE_URL || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  },
  tts: {
    // 'openai' — synthesis through the OpenAI-compatible endpoint above.
    // 'none'   — deliberate silent track (no key configured / offline demo).
    // Adding 'yandex' later means a new branch here, not a pipeline change.
    service: process.env.TTS_SERVICE || 'openai',
    // gpt-4o-mini-tts also honours `instructions` (tone, pace); tts-1 / tts-1-hd do not.
    model: process.env.TTS_MODEL || 'gpt-4o-mini-tts',
    format: (process.env.TTS_FORMAT || 'mp3') as 'mp3' | 'wav' | 'opus' | 'aac' | 'flac',
  },
  ffmpeg: {
    path: process.env.FFMPEG_PATH || '',
    probePath: process.env.FFPROBE_PATH || '',
    // Font used by the drawtext filter for captions. Without an explicit file
    // FFmpeg falls back to fontconfig's default, which on a minimal Alpine image
    // resolves to nothing and fails the render — and would not cover Cyrillic
    // even where it resolves.
    fontFile: process.env.FFMPEG_FONT_FILE || '',
  },
  limits: {
    maxFileSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB || '10', 10),
    maxPhotos: parseInt(process.env.MAX_PHOTOS || '20', 10),
  },
  retention: {
    // 0 disables expiry entirely (files are kept indefinitely).
    fileDays: parseInt(process.env.FILE_RETENTION_DAYS || '7', 10),
    // How often the sweep runs. 0 disables the schedule while leaving the sweep
    // available to call by hand.
    sweepHours: parseInt(process.env.RETENTION_SWEEP_HOURS || '6', 10),
  },
};