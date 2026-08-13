import { Request, Response } from 'express';
import { config } from '../config';
import { parseDurationMs } from './duration';

export const AUTH_COOKIE_NAME = 'token';

/**
 * The frontend and API are always same-origin from the browser's point of
 * view — proxied by Vite in dev and by nginx in Docker (see
 * frontend/vite.config.ts and frontend/nginx.conf) — so `sameSite: 'lax'`
 * costs nothing and blocks the cookie being sent on cross-site requests.
 * `secure` mirrors `req.secure`, which already accounts for `trust proxy`
 * (app.ts): true behind a TLS-terminating proxy, false over plain HTTP in
 * dev/CI — hardcoding `true` would silently stop the cookie being sent
 * wherever the deployment isn't behind HTTPS yet.
 */
function cookieOptions(req: Request) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: req.secure,
    path: '/',
  };
}

export function setAuthCookie(req: Request, res: Response, token: string): void {
  res.cookie(AUTH_COOKIE_NAME, token, {
    ...cookieOptions(req),
    maxAge: parseDurationMs(config.jwt.expiresIn, 7 * 86_400_000),
  });
}

export function clearAuthCookie(req: Request, res: Response): void {
  res.clearCookie(AUTH_COOKIE_NAME, cookieOptions(req));
}
