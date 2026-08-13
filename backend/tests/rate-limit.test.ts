// Production limits are the ones worth asserting; outside production the ceilings
// are deliberately loose so local work is not throttled. Set before any import so
// `src/config` and the limiter singletons see it.
process.env.NODE_ENV = 'production';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { bootTestApp } from './helpers/testApp';

let app: Express;
let close: () => Promise<void>;

beforeAll(async () => {
  const booted = await bootTestApp();
  app = booted.app;
  close = booted.close;
});

afterAll(async () => {
  await close();
});

describe('rate limiting (S3)', () => {
  it('trusts exactly one proxy hop so req.ip is the real client', () => {
    // Without this, nginx forwards everything and every visitor shares one
    // counter: the limiter would either never fire or block everyone at once.
    expect(app.get('trust proxy')).toBe(1);
  });

  it('stops password guessing on /auth/login', async () => {
    const statuses: number[] = [];

    for (let attempt = 0; attempt < 14; attempt += 1) {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: 'wrong-password' });
      statuses.push(response.status);
    }

    const firstBlocked = statuses.indexOf(429);
    expect(firstBlocked).toBeGreaterThan(0);
    expect(firstBlocked).toBeLessThanOrEqual(11);
    expect(statuses.slice(0, firstBlocked).every((status) => status === 401)).toBe(true);
  });

  it('answers a throttled request with the standard error contract', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'wrong-password' });

    expect(response.status).toBe(429);
    expect(response.body.success).toBe(false);
    expect(response.body.error.message).toBeTypeOf('string');
    expect(Object.keys(response.headers).some((header) => header.startsWith('ratelimit'))).toBe(
      true,
    );
  });

  it('throttles bulk registration separately from login', async () => {
    const statuses: number[] = [];

    for (let index = 0; index < 8; index += 1) {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ email: `bulk-${index}@example.com`, password: 'password123' });
      statuses.push(response.status);
    }

    expect(statuses).toContain(429);
    // The first few must still succeed, or the limit is simply broken.
    expect(statuses[0]).toBe(201);
  });

  it('never throttles /api/health', async () => {
    // Orchestrators poll this constantly; a limit here becomes a false outage.
    for (let index = 0; index < 40; index += 1) {
      const response = await request(app).get('/api/health');
      expect(response.status).not.toBe(429);
    }
  });
});
