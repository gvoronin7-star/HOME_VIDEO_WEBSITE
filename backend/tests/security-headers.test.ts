import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { bootTestApp } from './helpers/testApp';

/** Finding S4: no security headers and no CSP were sent at all. */

let app: Express;
let close: () => Promise<void>;

beforeAll(async () => {
  const booted = await bootTestApp();
  app = booted.app;
  close = booted.close;

  // Lay down files to exercise the static handler.
  const base = path.resolve(process.env.STORAGE_PATH!);
  fs.mkdirSync(path.join(base, 'pdfs'), { recursive: true });
  fs.mkdirSync(path.join(base, 'photos'), { recursive: true });
  fs.writeFileSync(path.join(base, 'pdfs', 'album.pdf'), '%PDF-1.4 test');
  fs.writeFileSync(path.join(base, 'photos', 'photo.jpg'), 'jpeg-bytes');
});

afterAll(async () => {
  await close();
});

describe('security headers (S4)', () => {
  it('sends a content security policy on API responses', async () => {
    const response = await request(app).get('/api/templates').expect(200);
    const csp = response.headers['content-security-policy'];

    expect(csp).toBeTypeOf('string');
    // This process serves JSON and media, never documents, so nothing should be
    // loadable or executable from its responses.
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('sets nosniff, frame and referrer protections', async () => {
    const response = await request(app).get('/api/templates').expect(200);

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBeTypeOf('string');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  });

  it('does not advertise the framework', async () => {
    const response = await request(app).get('/api/templates').expect(200);
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('sends HSTS so the header is right the moment TLS is added', async () => {
    const response = await request(app).get('/api/templates').expect(200);
    expect(response.headers['strict-transport-security']).toContain('max-age=31536000');
  });

  it('allows media to be embedded cross-origin', async () => {
    // The same-origin default would silently break video and photo display
    // whenever the frontend is not proxied through the same host.
    const response = await request(app).get('/uploads/photos/photo.jpg').expect(200);
    expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });
});

describe('static uploads (S4)', () => {
  it('serves media inline but forces PDFs to download', async () => {
    const photo = await request(app).get('/uploads/photos/photo.jpg').expect(200);
    expect(photo.headers['content-disposition']).toBe('inline');

    const pdf = await request(app).get('/uploads/pdfs/album.pdf').expect(200);
    expect(pdf.headers['content-disposition']).toBe('attachment');
  });

  it('marks uploaded files nosniff', async () => {
    const response = await request(app).get('/uploads/photos/photo.jpg').expect(200);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('carries a policy that neutralises anything served from the volume', async () => {
    const response = await request(app).get('/uploads/photos/photo.jpg').expect(200);
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('refuses directory listings', async () => {
    await request(app).get('/uploads/photos/').expect(404);
  });

  it('does not serve a file outside the uploads directory', async () => {
    // express.static normalises the path; assert it rather than assume it.
    const response = await request(app).get('/uploads/../package.json');
    expect(response.status).not.toBe(200);
  });
});
