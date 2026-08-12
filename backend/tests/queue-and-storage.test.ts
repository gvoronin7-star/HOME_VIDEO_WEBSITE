import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { bootTestApp, makeJpeg, registerUser, seedTemplate } from './helpers/testApp';

let app: Express;
let models: any;
let close: () => Promise<void>;
let storageService: any;
let buildShareUrl: (id: string) => string;

beforeAll(async () => {
  const booted = await bootTestApp();
  app = booted.app;
  models = booted.models;
  close = booted.close;
  storageService = (await import('../src/services/storage.service')).storageService;
  buildShareUrl = (await import('../src/utils/urls')).buildShareUrl;
  await seedTemplate(models);
});

afterAll(async () => {
  await close();
});

describe('queue unavailable (N3)', () => {
  it('answers 503 instead of hanging forever, and records why', async () => {
    // Nothing listens on the configured Redis port. Before the fix, ioredis
    // retried indefinitely and this request never produced a response at all.
    const { token, userId } = await registerUser(app);
    const template = await seedTemplate(models);

    const story = await models.Story.create({
      userId,
      title: 'Ждёт очередь',
      templateId: template.id,
      status: 'script_ready',
      tone: 'warm',
      voiceGender: 'female',
    });
    await models.StorySlide.create({
      storyId: story.id,
      imageUrl: '/uploads/photos/a.jpg',
      imageKey: 'photos/a.jpg',
      orderIndex: 0,
      isKeyFrame: true,
      durationSeconds: 4,
      caption: 'Фраза.',
    });

    const startedAt = Date.now();
    const response = await request(app)
      .post(`/api/stories/${story.id}/generate`)
      .set('Authorization', `Bearer ${token}`);
    const elapsed = Date.now() - startedAt;

    expect(response.status).toBe(503);
    expect(response.body.error.message).toMatch(/очеред/i);
    expect(elapsed).toBeLessThan(15_000);

    // The task must carry an actionable reason so the UI can show it.
    const tasks = await models.Task.findAll({ where: { storyId: story.id } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe('failed');
    expect(tasks[0].errorMessage).toMatch(/Redis/i);
  });

  it('does not accept a second generation while one is in flight', async () => {
    const { token, userId } = await registerUser(app);
    const template = await seedTemplate(models);

    const story = await models.Story.create({
      userId,
      title: 'Уже рендерится',
      templateId: template.id,
      status: 'rendering',
      tone: 'warm',
      voiceGender: 'female',
    });

    await request(app)
      .post(`/api/stories/${story.id}/generate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
  });

  it('allows generation from script_ready (B4)', async () => {
    // The server used to list script_ready among "already running" and reject the
    // one state a user actually launches rendering from.
    const { token, userId } = await registerUser(app);
    const template = await seedTemplate(models);

    const story = await models.Story.create({
      userId,
      title: 'Сценарий готов',
      templateId: template.id,
      status: 'script_ready',
      tone: 'warm',
      voiceGender: 'female',
    });

    const response = await request(app)
      .post(`/api/stories/${story.id}/generate`)
      .set('Authorization', `Bearer ${token}`);

    // 503 because Redis is down here — the point is that it is not 409.
    expect(response.status).not.toBe(409);
  });
});

describe('task progress reporting (F2, C3)', () => {
  it('exposes the task alongside the story so the UI can show real progress', async () => {
    const { token, userId } = await registerUser(app);
    const template = await seedTemplate(models);

    const story = await models.Story.create({
      userId,
      title: 'С прогрессом',
      templateId: template.id,
      status: 'rendering',
      tone: 'warm',
      voiceGender: 'female',
    });
    await models.Task.create({
      storyId: story.id,
      type: 'render_video',
      status: 'processing',
      progress: 40,
    });

    const response = await request(app)
      .get(`/api/stories/${story.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.data.task).not.toBeNull();
    expect(response.body.data.task.progress).toBe(40);
  });

  it('round-trips JSONB result data on SQLite (N2)', async () => {
    const { userId } = await registerUser(app);
    const template = await seedTemplate(models);

    const story = await models.Story.create({
      userId,
      title: 'resultData',
      templateId: template.id,
      status: 'draft',
      tone: 'warm',
      voiceGender: 'female',
    });

    const task = await models.Task.create({
      storyId: story.id,
      type: 'render_video',
      status: 'pending',
      progress: 0,
    });
    await task.update({ resultData: { scriptSource: 'llm', nested: { ok: true, n: 42 } } });

    const reloaded = await models.Task.findByPk(task.id);
    expect(reloaded.resultData.scriptSource).toBe('llm');
    expect(reloaded.resultData.nested.n).toBe(42);
  });
});

describe('storage keys (C1)', () => {
  it('normalises a public URL into a storage key', () => {
    // The database holds public URLs for videos, PDFs and QR codes but storage
    // keys for slide images. Mixing them produced uploads/uploads/... paths whose
    // ENOENT was swallowed, so those files were never deleted.
    expect(storageService.keyFromUrl('/uploads/videos/a.mp4')).toBe('videos/a.mp4');
    expect(storageService.keyFromUrl('uploads/videos/a.mp4')).toBe('videos/a.mp4');
    expect(storageService.keyFromUrl('videos/a.mp4')).toBe('videos/a.mp4');
  });

  it('deletes every artefact when a story is removed', async () => {
    const { token } = await registerUser(app);
    const template = await seedTemplate(models);
    const photo = await makeJpeg();

    const created = await request(app)
      .post('/api/stories')
      .set('Authorization', `Bearer ${token}`)
      .field('templateId', template.id)
      .attach('photos', photo, 'a.jpg')
      .expect(201);

    const storyId = created.body.data.story.id;
    const story = await models.Story.findByPk(storyId);
    const slide = await models.StorySlide.findOne({ where: { storyId } });

    const base = path.resolve(process.env.STORAGE_PATH!);
    const artefacts = {
      photo: path.join(base, slide.imageKey),
      video: path.join(base, 'videos', `story-${storyId}.mp4`),
      pdf: path.join(base, 'pdfs', `album-${storyId}.pdf`),
      qr: path.join(base, 'qrcodes', `qr-${storyId}.png`),
    };

    for (const file of Object.values(artefacts)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (!fs.existsSync(file)) fs.writeFileSync(file, 'x');
    }

    await story.update({
      videoUrl: `/uploads/videos/story-${storyId}.mp4`,
      pdfUrl: `/uploads/pdfs/album-${storyId}.pdf`,
      qrCodeUrl: `/uploads/qrcodes/qr-${storyId}.png`,
    });

    await request(app)
      .delete(`/api/stories/${storyId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(fs.existsSync(artefacts.photo)).toBe(false);
    expect(fs.existsSync(artefacts.video)).toBe(false);
    expect(fs.existsSync(artefacts.pdf)).toBe(false);
    expect(fs.existsSync(artefacts.qr)).toBe(false);
    expect(await models.StorySlide.count({ where: { storyId } })).toBe(0);
  });
});

describe('public share URL (C4)', () => {
  it('points at the frontend origin, not the API', () => {
    // `/share/:id` is a client-side route: the API would answer 404. Building it
    // from CORS_ORIGIN was doubly wrong — that is a list of permitted origins.
    const url = buildShareUrl('abc-123');
    expect(url).toBe('http://localhost:3000/share/abc-123');
  });

  it('never produces a double slash', async () => {
    expect(buildShareUrl('x')).not.toMatch(/[^:]\/\//);
  });
});
