import rateLimit, { Options } from 'express-rate-limit';
import { Request, Response } from 'express';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Request rate limits.
 *
 * Nothing was limited before: password guessing on `/api/auth/login`, unbounded
 * story creation (each one costs LLM calls, speech synthesis and a video render),
 * and an open public share endpoint.
 *
 * State is held in memory, which is correct for the current single-API-container
 * deployment. Scaling the API horizontally will need a shared store (the Redis
 * connection is already there) — otherwise each instance counts separately and the
 * effective limit multiplies by the instance count.
 */

/** Shared response shape so clients get the same error contract everywhere. */
function limitReached(req: Request, res: Response, retryAfterHint: string): void {
  logger.warn({ ip: req.ip, path: req.path, method: req.method }, 'Rate limit exceeded');

  res.status(429).json({
    success: false,
    error: { message: `Слишком много запросов. ${retryAfterHint}` },
  });
}

const shared: Partial<Options> = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Limits protect shared capacity, so they are pointless if disabled in dev by
  // accident — they are always on, only the ceilings differ.
  skip: () => false,
};

/**
 * Credentials. Deliberately the tightest limit: this is the only endpoint where
 * an attacker gains something by repeating a request thousands of times.
 * Counts failures only, so a legitimate user signing in repeatedly is unaffected.
 */
export const authLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: config.server.nodeEnv === 'production' ? 10 : 100,
  skipSuccessfulRequests: true,
  handler: (req, res) => limitReached(req, res, 'Повторите попытку через 15 минут.'),
});

/** Registration: throttled to stop bulk account creation. */
export const registerLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60 * 1000,
  limit: config.server.nodeEnv === 'production' ? 5 : 100,
  handler: (req, res) => limitReached(req, res, 'Повторите попытку позже.'),
});

/**
 * Expensive work: uploads, generation, previews. Each request can cost paid API
 * calls and minutes of CPU, so this guards the wallet as much as the server.
 */
export const generationLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60 * 1000,
  limit: config.server.nodeEnv === 'production' ? 20 : 200,
  handler: (req, res) =>
    limitReached(req, res, 'Слишком много запусков генерации. Попробуйте через час.'),
});

/** Public share pages: generous, but no longer unbounded. */
export const publicLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: 300,
  handler: (req, res) => limitReached(req, res, 'Повторите попытку через несколько минут.'),
});

/** Backstop for everything else. */
export const globalLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  handler: (req, res) => limitReached(req, res, 'Повторите попытку через несколько минут.'),
});
