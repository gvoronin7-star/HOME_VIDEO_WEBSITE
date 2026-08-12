import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { bootTestApp, makeJpeg, registerUser, seedTemplate, seedVoiceProfiles } from './helpers/testApp';

let app: Express;
let models: any;
let close: () => Promise<void>;

beforeAll(async () => {
  const booted = await bootTestApp();
  app = booted.app;
  models = booted.models;
  close = booted.close;
  await seedTemplate(models);
  await seedVoiceProfiles(models);
});

afterAll(async () => {
  await close();
});

describe('auth', () => {
  it('registers a user and returns a usable token', async () => {
    const { token, userId } = await registerUser(app);

    // Regression guard for B0: model attribute reads used to return undefined
    // because TypeScript class fields shadowed Sequelize's getters, so the token
    // was minted without an id and every authorised request answered 401.
    expect(userId).toBeTypeOf('string');
    expect(userId.length).toBeGreaterThan(0);

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(me.body.data.user.id).toBe(userId);
  });

  it('rejects a duplicate email', async () => {
    const email = 'duplicate@example.com';
    await registerUser(app, email);

    await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'password123' })
      .expect(409);
  });

  it('rejects a malformed email and a short password', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: 'password123' })
      .expect(422);

    await request(app)
      .post('/api/auth/register')
      .send({ email: 'shortpass@example.com', password: '123' })
      .expect(422);
  });

  it('refuses a wrong password without leaking which field was wrong', async () => {
    const email = 'wrongpass@example.com';
    await registerUser(app, email);

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'definitely-wrong' })
      .expect(401);

    expect(response.body.error.message).toBe('Неверный email или пароль');
  });
});

describe('reference data', () => {
  it('serves a non-empty template list (B3)', async () => {
    // An empty list makes story creation impossible: a template is mandatory.
    const response = await request(app).get('/api/templates').expect(200);
    expect(response.body.data.templates.length).toBeGreaterThan(0);
  });

  it('serves voice profiles with gender and mood (F1)', async () => {
    const response = await request(app).get('/api/voices').expect(200);
    const voices = response.body.data.voices;

    expect(voices.length).toBeGreaterThan(0);
    expect(voices[0]).toHaveProperty('gender');
    expect(voices[0]).toHaveProperty('emotion');
  });
});

describe('story creation (B1)', () => {
  it('creates a story with slides and runs script generation in the background', async () => {
    const { token } = await registerUser(app);
    const template = await seedTemplate(models);
    const photo = await makeJpeg();

    // This endpoint answered 500 on every call: handlers were passed to Express
    // unbound, so `this.generateScript(...)` threw a TypeError.
    const response = await request(app)
      .post('/api/stories')
      .set('Authorization', `Bearer ${token}`)
      .field('templateId', template.id)
      .field('tone', 'warm')
      .field('voiceGender', 'female')
      .attach('photos', photo, 'a.jpg')
      .attach('photos', photo, 'b.jpg')
      .expect(201);

    expect(response.body.data.story.slidesCount).toBe(2);
    const storyId = response.body.data.story.id;

    const slides = await models.StorySlide.findAll({ where: { storyId } });
    expect(slides).toHaveLength(2);

    // The background call is what used to throw; it must move the story on.
    await expect
      .poll(
        async () => {
          const story = await models.Story.findByPk(storyId);
          return story.status;
        },
        { timeout: 20_000, interval: 250 }
      )
      .not.toBe('draft');
  });

  it('rejects a request with no photos', async () => {
    const { token } = await registerUser(app);
    const template = await seedTemplate(models);

    await request(app)
      .post('/api/stories')
      .set('Authorization', `Bearer ${token}`)
      .field('templateId', template.id)
      .expect(422);
  });

  it('rejects an unknown template', async () => {
    const { token } = await registerUser(app);
    const photo = await makeJpeg();

    await request(app)
      .post('/api/stories')
      .set('Authorization', `Bearer ${token}`)
      .field('templateId', '11111111-1111-4111-8111-111111111111')
      .attach('photos', photo, 'a.jpg')
      .expect(404);
  });

  it('requires authentication', async () => {
    await request(app).get('/api/stories').expect(401);
  });

  it('does not expose another user\'s story', async () => {
    const owner = await registerUser(app);
    const stranger = await registerUser(app);
    const template = await seedTemplate(models);
    const photo = await makeJpeg();

    const created = await request(app)
      .post('/api/stories')
      .set('Authorization', `Bearer ${owner.token}`)
      .field('templateId', template.id)
      .attach('photos', photo, 'a.jpg')
      .expect(201);

    await request(app)
      .get(`/api/stories/${created.body.data.story.id}`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .expect(404);
  });
});

describe('slide editing (F4)', () => {
  async function storyWithSlide() {
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
    const slide = await models.StorySlide.findOne({ where: { storyId } });
    return { token, storyId, slide };
  }

  it('saves caption, duration, order and key-frame changes', async () => {
    const { token, storyId, slide } = await storyWithSlide();

    await request(app)
      .put(`/api/stories/${storyId}/slides`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        slides: [
          { id: slide.id, orderIndex: 0, caption: 'Новый текст кадра.', durationSeconds: 7, isKeyFrame: true },
        ],
      })
      .expect(200);

    await slide.reload();
    expect(slide.caption).toBe('Новый текст кадра.');
    expect(slide.durationSeconds).toBe(7);
    expect(slide.isKeyFrame).toBe(true);
  });

  it('accepts shell metacharacters as ordinary text', async () => {
    // S1 is fixed at the root, so these are just characters. The earlier ban on
    // them also blocked quotation marks and apostrophes that narration needs.
    const { token, storyId, slide } = await storyWithSlide();
    const caption = 'Он сказал: "$(эхо)" — и добавил `почти` всё; ладно.';

    await request(app)
      .put(`/api/stories/${storyId}/slides`)
      .set('Authorization', `Bearer ${token}`)
      .send({ slides: [{ id: slide.id, orderIndex: 0, caption, durationSeconds: 4, isKeyFrame: false }] })
      .expect(200);

    await slide.reload();
    expect(slide.caption).toBe(caption);
  });

  it.each([
    ['an empty slide array', { slides: [] }],
    ['a duration above the maximum', null],
    ['a duration below the minimum', null],
    ['a non-uuid slide id', null],
    ['a control character in the caption', null],
  ])('rejects %s with 422', async (label, explicitBody) => {
    const { token, storyId, slide } = await storyWithSlide();

    const bodies: Record<string, unknown> = {
      'an empty slide array': { slides: [] },
      'a duration above the maximum': {
        slides: [{ id: slide.id, orderIndex: 0, caption: 'ок', durationSeconds: 999, isKeyFrame: false }],
      },
      'a duration below the minimum': {
        slides: [{ id: slide.id, orderIndex: 0, caption: 'ок', durationSeconds: 0, isKeyFrame: false }],
      },
      'a non-uuid slide id': {
        slides: [{ id: 'not-a-uuid', orderIndex: 0, caption: 'ок', durationSeconds: 4, isKeyFrame: false }],
      },
      'a control character in the caption': {
        slides: [
          {
            id: slide.id,
            orderIndex: 0,
            caption: `текст${String.fromCharCode(0)}с нулём`,
            durationSeconds: 4,
            isKeyFrame: false,
          },
        ],
      },
    };

    await request(app)
      .put(`/api/stories/${storyId}/slides`)
      .set('Authorization', `Bearer ${token}`)
      .send((explicitBody as any) ?? bodies[label])
      .expect(422);
  });

  it('rejects a non-uuid story id in the path', async () => {
    const { token } = await registerUser(app);

    await request(app)
      .get('/api/stories/not-a-uuid/status')
      .set('Authorization', `Bearer ${token}`)
      .expect(422);
  });
});

describe('preview guards (F3)', () => {
  it('refuses a story with no slides', async () => {
    const { token, userId } = await registerUser(app);
    const template = await seedTemplate(models);

    const story = await models.Story.create({
      userId,
      title: 'Без кадров',
      templateId: template.id,
      status: 'draft',
      tone: 'warm',
      voiceGender: 'female',
    });

    const response = await request(app)
      .post(`/api/stories/${story.id}/preview`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);

    expect(response.body.error.message).toMatch(/кадр/i);
  });

  it('refuses a story whose slides have no script yet, and says so', async () => {
    const { token, userId } = await registerUser(app);
    const template = await seedTemplate(models);

    const story = await models.Story.create({
      userId,
      title: 'Без сценария',
      templateId: template.id,
      status: 'draft',
      tone: 'warm',
      voiceGender: 'female',
    });
    await models.StorySlide.create({
      storyId: story.id,
      imageUrl: '/uploads/photos/x.jpg',
      imageKey: 'photos/x.jpg',
      orderIndex: 0,
      isKeyFrame: false,
      durationSeconds: 4,
      caption: '',
    });

    const response = await request(app)
      .post(`/api/stories/${story.id}/preview`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);

    expect(response.body.error.message).toMatch(/сценари/i);
  });
});

describe('public sharing', () => {
  it('hides a story that is not ready and never leaks the owner', async () => {
    const { userId } = await registerUser(app);
    const template = await seedTemplate(models);

    const draft = await models.Story.create({
      userId,
      title: 'Черновик',
      templateId: template.id,
      status: 'draft',
      tone: 'warm',
      voiceGender: 'female',
    });

    await request(app).get(`/api/share/${draft.id}`).expect(404);

    await draft.update({ status: 'ready', videoUrl: '/uploads/videos/x.mp4' });

    const response = await request(app).get(`/api/share/${draft.id}`).expect(200);
    expect(response.body.data.story.videoUrl).toBe('/uploads/videos/x.mp4');
    expect(JSON.stringify(response.body)).not.toContain(userId);
  });
});

describe('unknown routes', () => {
  it('answers 404 with the standard error contract', async () => {
    const response = await request(app).get('/api/nope').expect(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.message).toBeTypeOf('string');
  });
});
