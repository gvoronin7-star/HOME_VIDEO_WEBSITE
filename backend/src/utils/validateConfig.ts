import { config } from '../config';
import { logger } from './logger';

/** Values that ship with the project and must never protect a real deployment. */
const KNOWN_WEAK_SECRETS = new Set([
  'dev-secret-key',
  'your-super-secret-jwt-key-change-in-production',
  'secret',
  'changeme',
]);

/** Shortest secret that is not trivially brute-forced. */
const MIN_SECRET_LENGTH = 32;

/**
 * Refuse to start a production server with a guessable JWT secret.
 *
 * The default `dev-secret-key` is published in this repository, in `.env.example`
 * and previously in `docker-compose.yml`. Anyone who knows it can mint a token for
 * any user, so a deployment that silently fell back to it was wide open while
 * looking perfectly healthy. Failing at startup makes that impossible to miss.
 *
 * Outside production the defaults stay usable — local development should not need
 * ceremony — but a warning is still emitted so the state is never a surprise.
 */
export function validateSecurityConfig(): void {
  const isProduction = config.server.nodeEnv === 'production';
  const secret = config.jwt.secret;
  const problems: string[] = [];

  if (!secret) {
    problems.push('JWT_SECRET не задан');
  } else if (KNOWN_WEAK_SECRETS.has(secret)) {
    problems.push('JWT_SECRET равен значению из примера конфигурации — оно общеизвестно');
  } else if (secret.length < MIN_SECRET_LENGTH) {
    problems.push(`JWT_SECRET короче ${MIN_SECRET_LENGTH} символов (сейчас ${secret.length})`);
  }

  if (problems.length === 0) {
    return;
  }

  if (isProduction) {
    logger.fatal(
      { problems },
      'Небезопасная конфигурация для production. Задайте стойкий JWT_SECRET, ' +
        "например: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"",
    );
    process.exit(1);
  }

  logger.warn(
    { problems, nodeEnv: config.server.nodeEnv },
    'Небезопасная конфигурация — допустимо только для локальной разработки. ' +
      'В production сервер с такими значениями не запустится',
  );
}
