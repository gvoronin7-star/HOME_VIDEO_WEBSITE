import crypto from 'crypto';
import type { Express } from 'express';
import type { Sequelize } from 'sequelize';
import sharp from 'sharp';

/**
 * Boot the real application against a fresh SQLite schema.
 *
 * Modules are imported dynamically so a test file can adjust process.env before
 * `src/config` snapshots it. Import statements would be hoisted and run first,
 * which is why this is a function rather than a set of top-level imports.
 */
export async function bootTestApp(): Promise<{
  app: Express;
  sequelize: Sequelize;
  models: any;
  close: () => Promise<void>;
}> {
  const sequelize = (await import('../../src/models/sequelize')).default;
  const models = await import('../../src/models');
  const { createApp } = await import('../../src/app');

  await sequelize.sync({ force: true });

  const app = createApp();

  return {
    app,
    sequelize: sequelize as unknown as Sequelize,
    models,
    close: async () => {
      await sequelize.close();
    },
  };
}

/** A real, decodable JPEG — sharp and multer both reject placeholder bytes. */
export async function makeJpeg(label = '#4a6fa5'): Promise<Buffer> {
  return sharp({
    create: { width: 64, height: 48, channels: 3, background: label },
  })
    .jpeg()
    .toBuffer();
}

/** Register a user through the API and return the bearer token. */
export async function registerUser(
  app: Express,
  email = `u-${crypto.randomUUID()}@example.com`
): Promise<{ token: string; email: string; userId: string }> {
  const request = (await import('supertest')).default;

  const response = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'password123', name: 'Тестовый пользователь' })
    .expect(201);

  return {
    token: response.body.data.token,
    email,
    userId: response.body.data.user.id,
  };
}

/** Seed the one template a story needs, mirroring utils/seed.ts. */
export async function seedTemplate(models: any, name = 'День на даче') {
  const [template] = await models.Template.findOrCreate({
    where: { name },
    defaults: {
      name,
      description: 'Тёплые моменты загородной жизни.',
      tone: 'warm',
      defaultDurationSeconds: 4,
      promptTemplate: 'Создай тёплый сценарий о семейном дне на даче.',
    },
  });
  return template;
}

export async function seedVoiceProfiles(models: any) {
  const profiles = [
    { name: 'Елена (тёплый)', gender: 'female', emotion: 'warm', apiVoiceId: 'nova' },
    { name: 'Алексей (спокойный)', gender: 'male', emotion: 'calm', apiVoiceId: 'echo' },
  ];

  for (const profile of profiles) {
    await models.VoiceProfile.findOrCreate({ where: { name: profile.name }, defaults: profile });
  }
}
