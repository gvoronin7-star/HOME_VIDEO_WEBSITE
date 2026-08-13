import { config } from '../config';

/**
 * Public page of a finished story — the single place this URL is built.
 *
 * `/share/:token` is a route of the frontend SPA, so the origin must be the one
 * the frontend is served from (`PUBLIC_URL`), not the API and not `CORS_ORIGIN`.
 * The link is embedded in QR codes and printed into the PDF album, so it has to
 * be resolvable from another device.
 *
 * Takes the story's `shareToken`, never its id — the token is what a revoke or
 * rotate action invalidates. Building this from the id would make the link
 * unrevocable, since the id can't change without breaking every foreign key
 * that points at the story.
 */
export function buildShareUrl(shareToken: string): string {
  return `${config.server.publicUrl}/share/${shareToken}`;
}
