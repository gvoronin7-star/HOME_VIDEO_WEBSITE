import { config } from '../config';

/**
 * Public page of a finished story — the single place this URL is built.
 *
 * `/share/:id` is a route of the frontend SPA, so the origin must be the one the
 * frontend is served from (`PUBLIC_URL`), not the API and not `CORS_ORIGIN`.
 * The link is embedded in QR codes and printed into the PDF album, so it has to
 * be resolvable from another device.
 */
export function buildShareUrl(storyId: string): string {
  return `${config.server.publicUrl}/share/${storyId}`;
}
