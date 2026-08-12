import pino from 'pino';
import { config } from '../config';

const isProduction = config.server.nodeEnv === 'production';
const isTest = config.server.nodeEnv === 'test';

/**
 * `LOG_LEVEL` overrides the level explicitly; tests set it to `silent`.
 * Pretty-printing is skipped outside development because it spawns a worker
 * thread, which keeps a test runner from exiting cleanly.
 */
const level = process.env.LOG_LEVEL || (isProduction ? 'info' : isTest ? 'silent' : 'debug');

export const logger = pino({
  level,
  transport:
    !isProduction && !isTest && level !== 'silent'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:dd-mm-yyyy HH:MM:ss',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'body.password', 'body.token'],
    censor: '[REDACTED]',
  },
});
