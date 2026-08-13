/**
 * Parses simple durations like '7d', '12h', '30m', '45s' — the shape
 * `JWT_EXPIRES_IN` already uses for `jsonwebtoken` — into milliseconds, for
 * places that need a plain number instead (e.g. a cookie's `maxAge`).
 * Falls back to `fallbackMs` on anything else, rather than throwing: this
 * only feeds a session lifetime, not `jwt.verify`, so a malformed value
 * should degrade to a sane default, not take the process down.
 */
export function parseDurationMs(input: string, fallbackMs: number): number {
  const match = /^(\d+)\s*(s|m|h|d)$/.exec(input.trim());
  if (!match) return fallbackMs;

  const value = Number(match[1]);
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };

  return value * multipliers[match[2]];
}
