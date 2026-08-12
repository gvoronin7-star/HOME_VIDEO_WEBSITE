import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestApp, registerUser, seedTemplate } from './helpers/testApp';
import type { Express } from 'express';

/**
 * Finding S7: the ТЗ promises files are deleted after a period and the method to do
 * it existed from the start — but nothing ever called it, so family photographs
 * were kept indefinitely.
 */

let app: Express;
let models: any;
let close: () => Promise<void>;
let runRetentionSweep: (days?: number) => Promise<any>;
let storageService: any;
let uploadsBase: string;
let sequelize: any;

/** Create a story whose createdAt is backdated by `ageDays`, with real files. */
async function makeStory(userId: string, templateId: string, ageDays: number, label: string) {
  const createdAt = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);

  const story = await models.Story.create({
    userId,
    title: label,
    templateId,
    status: 'ready',
    tone: 'warm',
    voiceGender: 'female',
    videoUrl: `/uploads/videos/${label}.mp4`,
    pdfUrl: `/uploads/pdfs/${label}.pdf`,
    qrCodeUrl: `/uploads/qrcodes/${label}.png`,
  });

  // Sequelize manages `createdAt` and ignores attempts to assign it through the
  // model, so ageing a row for this test needs a direct statement.
  await sequelize.query('UPDATE stories SET "createdAt" = :createdAt WHERE id = :id', {
    replacements: { createdAt: createdAt.toISOString(), id: story.id },
  });

  await models.StorySlide.create({
    storyId: story.id,
    imageUrl: `/uploads/photos/${label}.jpg`,
    imageKey: `photos/${label}.jpg`,
    orderIndex: 0,
    isKeyFrame: true,
    durationSeconds: 4,
    caption: 'Кадр.',
  });

  const files = [
    path.join(uploadsBase, 'photos', `${label}.jpg`),
    path.join(uploadsBase, 'videos', `${label}.mp4`),
    path.join(uploadsBase, 'pdfs', `${label}.pdf`),
    path.join(uploadsBase, 'qrcodes', `${label}.png`),
  ];

  for (const file of files) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'x');
  }

  return { story, files };
}

beforeAll(async () => {
  const booted = await bootTestApp();
  app = booted.app;
  models = booted.models;
  close = booted.close;
  sequelize = booted.sequelize;

  runRetentionSweep = (await import('../src/services/retention.service')).runRetentionSweep;
  storageService = (await import('../src/services/storage.service')).storageService;
  uploadsBase = path.resolve(process.env.STORAGE_PATH!);

  await seedTemplate(models);
});

afterAll(async () => {
  await close();
});

describe('retention sweep (S7)', () => {
  it('expires stories past the window and deletes every file they own', async () => {
    const { userId } = await registerUser(app);
    const template = await seedTemplate(models);

    const old = await makeStory(userId, template.id, 30, 'expired-story');
    const fresh = await makeStory(userId, template.id, 1, 'recent-story');

    const result = await runRetentionSweep(7);

    expect(result.expiredStories).toBeGreaterThanOrEqual(1);

    // Row and files both gone.
    expect(await models.Story.findByPk(old.story.id)).toBeNull();
    for (const file of old.files) {
      expect(fs.existsSync(file)).toBe(false);
    }

    // Cascade must take the slides with it, or they become orphans.
    expect(await models.StorySlide.count({ where: { storyId: old.story.id } })).toBe(0);

    // Anything inside the window is untouched.
    expect(await models.Story.findByPk(fresh.story.id)).not.toBeNull();
    for (const file of fresh.files) {
      expect(fs.existsSync(file)).toBe(true);
    }
  });

  it('expires whole stories rather than orphaning file references', async () => {
    // Deleting files by age alone — what the original helper did — would leave rows
    // pointing at images that no longer exist, turning a privacy feature into a
    // source of broken stories.
    const { userId } = await registerUser(app);
    const template = await seedTemplate(models);
    const old = await makeStory(userId, template.id, 90, 'orphan-check');

    await runRetentionSweep(7);

    const remaining = await models.Story.findAll();
    for (const story of remaining) {
      const slides = await models.StorySlide.findAll({ where: { storyId: story.id } });
      for (const slide of slides) {
        // Every surviving row must still have its file on disk.
        expect(fs.existsSync(storageService.getFilePath(slide.imageKey))).toBe(true);
      }
    }

    expect(await models.Story.findByPk(old.story.id)).toBeNull();
  });

  it('keeps everything when retention is disabled, but still sweeps temp', async () => {
    const { userId } = await registerUser(app);
    const template = await seedTemplate(models);
    const old = await makeStory(userId, template.id, 365, 'disabled-retention');

    const result = await runRetentionSweep(0);

    expect(result.expiredStories).toBe(0);
    expect(await models.Story.findByPk(old.story.id)).not.toBeNull();
  });

  it('removes stale render scratch directories', async () => {
    const tempDir = path.join(uploadsBase, 'temp');
    const stale = path.join(tempDir, 'stale-render-job');
    const recent = path.join(tempDir, 'recent-render-job');

    fs.mkdirSync(stale, { recursive: true });
    fs.mkdirSync(recent, { recursive: true });
    fs.writeFileSync(path.join(stale, 'slide_000.mp4'), 'x');
    fs.writeFileSync(path.join(recent, 'slide_000.mp4'), 'x');

    // Backdate the stale one by two days.
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    fs.utimesSync(stale, twoDaysAgo, twoDaysAgo);

    const removed = await storageService.cleanupTempFiles(24);

    expect(removed).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(stale)).toBe(false);
    // A job that may still be running must survive.
    expect(fs.existsSync(recent)).toBe(true);
  });

  it('survives a story it cannot delete and keeps going', async () => {
    const { userId } = await registerUser(app);
    const template = await seedTemplate(models);

    const first = await makeStory(userId, template.id, 60, 'sweep-one');
    const second = await makeStory(userId, template.id, 60, 'sweep-two');

    // Files already missing is the common real case — it must not abort the sweep.
    for (const file of first.files) fs.rmSync(file, { force: true });

    const result = await runRetentionSweep(7);

    expect(result.expiredStories).toBeGreaterThanOrEqual(2);
    expect(await models.Story.findByPk(first.story.id)).toBeNull();
    expect(await models.Story.findByPk(second.story.id)).toBeNull();
  });
});
