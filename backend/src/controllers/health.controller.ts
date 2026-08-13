import { Request, Response } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger';
import { Redis } from 'ioredis';
import { config } from '../config';
import sequelize from '../models/sequelize';

const execFileAsync = promisify(execFile);

export interface HealthCheckResult {
  status: 'ok' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  checks: {
    database: 'ok' | 'error';
    redis: 'ok' | 'error';
    ffmpeg: 'ok' | 'error';
  };
  details?: {
    database?: string;
    redis?: string;
    ffmpeg?: string;
  };
}

export async function healthCheck(req: Request, res: Response) {
  const checks = {
    database: 'error' as 'ok' | 'error',
    redis: 'error' as 'ok' | 'error',
    ffmpeg: 'error' as 'ok' | 'error',
  };

  const details: Record<string, string> = {};
  let status: 'ok' | 'degraded' | 'unhealthy' = 'ok';

  // Check 1: Database
  try {
    await sequelize.query('SELECT 1');
    checks.database = 'ok';
    details.database = 'connected';
  } catch (error: unknown) {
    checks.database = 'error';
    details.database = error instanceof Error ? error.message : 'Unknown error';
    status = 'unhealthy';
    logger.error({ error: details.database }, 'Health check: database error');
  }

  // Check 2: Redis
  try {
    const redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      // Required: ioredis connects on construction by default, and calling
      // connect() on an already-connecting client rejects with "Redis is already
      // connecting/connected" — which made this check report an error even when
      // Redis was perfectly healthy.
      lazyConnect: true,
      // A health probe must not retry forever behind the caller's back.
      retryStrategy: () => null,
    });

    // ioredis prints "Unhandled error event" without a listener, which would
    // pollute the log on every poll while Redis is down. The failure is already
    // reported through the rejected promise below.
    redis.on('error', () => {});

    try {
      await redis.connect();
      await redis.ping();
      checks.redis = 'ok';
      details.redis = 'connected';
    } finally {
      redis.disconnect();
    }
  } catch (error: unknown) {
    checks.redis = 'error';
    details.redis = error instanceof Error ? error.message : 'Unknown error';
    status = status === 'unhealthy' ? 'unhealthy' : 'degraded';
    logger.error({ error: details.redis }, 'Health check: redis error');
  }

  // Check 3: FFmpeg
  try {
    // Use the configured binary, not a bare 'ffmpeg' — otherwise the check passes
    // or fails independently of what the render actually runs. execFile with an
    // argument array also means a path with spaces works.
    const { stdout } = await execFileAsync(config.ffmpeg.path || 'ffmpeg', ['-version'], {
      timeout: 5000,
    });
    const versionLine = stdout.split('\n')[0];
    checks.ffmpeg = 'ok';
    details.ffmpeg = versionLine || 'available';
  } catch (error: unknown) {
    checks.ffmpeg = 'error';
    details.ffmpeg = error instanceof Error ? error.message : 'Unknown error';
    status = status === 'unhealthy' ? 'unhealthy' : 'degraded';
    logger.error({ error: details.ffmpeg }, 'Health check: ffmpeg error');
  }

  const result: HealthCheckResult = {
    status,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks,
    details: Object.keys(details).length > 0 ? details : undefined,
  };

  const statusCode = status === 'ok' ? 200 : status === 'degraded' ? 200 : 503;

  res.status(statusCode).json(result);
}
