import sharp from 'sharp';
import bcrypt from 'bcryptjs';
import sequelize from '../models/sequelize';
import { Story, StorySlide, Template, User } from '../models';
import { storageService } from '../services/storage.service';
import { logger } from '../utils/logger';

/**
 * Demo fixtures: a signed-in user and a few ready-to-generate stories.
 *
 * Photos are generated as gradient placeholders rather than shipped as binaries,
 * so the script has no external assets and can run on a clean checkout. Videos
 * are NOT rendered here — press "Запустить генерацию" in the UI, which is what a
 * demo is meant to show.
 *
 * Idempotent: re-running reuses the demo user and skips stories already present.
 */

const DEMO_EMAIL = 'demo@family-cinema.local';
const DEMO_PASSWORD = 'demo1234';

interface DemoStory {
  title: string;
  templateName: string;
  tone: string;
  voiceGender: 'male' | 'female';
  /** One caption per slide; also drives how many photos are generated. */
  captions: string[];
  colors: string[];
}

const DEMO_STORIES: DemoStory[] = [
  {
    title: 'Лето на даче',
    templateName: 'День на даче',
    tone: 'warm',
    voiceGender: 'female',
    colors: ['#7cb342', '#aed581', '#f9a825', '#ef6c00', '#5d4037'],
    captions: [
      'Это лето началось с запаха скошенной травы и бабушкиных пирогов на веранде.',
      'Мы посадили яблоню у забора и договорились приезжать каждый год, чтобы смотреть, как она растёт.',
      'Вечером включили гирлянду над столом, и двор стал похож на маленький театр.',
      'Костёр догорал долго, а мы всё сидели и не хотели уходить спать.',
      'Утром уезжали молча — так бывает, когда всё было хорошо и слова только помешают.',
    ],
  },
  {
    title: 'Первый класс',
    templateName: 'Первый день в школе',
    tone: 'solemn',
    voiceGender: 'male',
    colors: ['#1565c0', '#42a5f5', '#fbc02d', '#e53935'],
    captions: [
      'Форма была куплена за месяц, и всё это время висела на стуле, как обещание.',
      'Букет оказался больше, чем сам первоклассник, и это никого не смутило.',
      'На первом звонке он держал нас за руки чуть крепче обычного.',
      'А потом отпустил и пошёл в класс сам. Мы стояли и смотрели, пока дверь не закрылась.',
    ],
  },
  {
    title: 'Новый дом',
    templateName: 'Переезд',
    tone: 'warm',
    voiceGender: 'female',
    colors: ['#6d4c41', '#a1887f', '#26a69a', '#80cbc4'],
    captions: [
      'Сначала здесь было только эхо и коробки до потолка.',
      'Первым делом повесили полку с фотографиями — чтобы стены перестали быть чужими.',
      'Кухня заработала раньше остального: чайник важнее шкафов.',
      'Через неделю дом уже знал, где кто спит, и перестал казаться большим.',
    ],
  },
];

/** Gradient placeholder standing in for a family photo. */
async function generatePhoto(from: string, to: string, label: string): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${from}"/>
        <stop offset="100%" stop-color="${to}"/>
      </linearGradient>
    </defs>
    <rect width="1920" height="1080" fill="url(#g)"/>
    <text x="960" y="1020" font-family="sans-serif" font-size="44"
          fill="#ffffff" fill-opacity="0.75" text-anchor="middle">${label}</text>
  </svg>`;

  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}

async function demoSeed(): Promise<void> {
  await sequelize.authenticate();
  logger.info('Database connected');

  const [user] = await User.findOrCreate({
    where: { email: DEMO_EMAIL },
    defaults: {
      email: DEMO_EMAIL,
      name: 'Демо-пользователь',
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 12),
    },
  });

  for (const demo of DEMO_STORIES) {
    const template = await Template.findOne({ where: { name: demo.templateName } });
    if (!template) {
      logger.warn(
        { template: demo.templateName },
        'Template missing — run the reference seed first (node dist/utils/seed.js)',
      );
      continue;
    }

    const existing = await Story.findOne({ where: { userId: user.id, title: demo.title } });
    if (existing) {
      logger.info({ title: demo.title }, 'Demo story already present, skipping');
      continue;
    }

    const story = await Story.create({
      userId: user.id,
      title: demo.title,
      templateId: template.id,
      // Captions are already written, so the story is ready to render — which is
      // the interesting starting point for a demo.
      status: 'script_ready',
      tone: demo.tone,
      voiceGender: demo.voiceGender,
      scriptText: demo.captions.join(' '),
    });

    for (let i = 0; i < demo.captions.length; i++) {
      const buffer = await generatePhoto(
        demo.colors[i % demo.colors.length],
        demo.colors[(i + 1) % demo.colors.length],
        `${demo.title} — кадр ${i + 1}`,
      );

      const { url, key } = await storageService.saveFile(buffer, `demo-${i}.jpg`, 'photos');

      await StorySlide.create({
        storyId: story.id,
        imageUrl: url,
        imageKey: key,
        orderIndex: i,
        isKeyFrame: i === 0,
        caption: demo.captions[i],
        durationSeconds: template.defaultDurationSeconds,
      });
    }

    logger.info({ title: demo.title, slides: demo.captions.length }, 'Demo story created');
  }

  logger.info(
    { email: DEMO_EMAIL, password: DEMO_PASSWORD },
    'Demo data ready — sign in with these credentials',
  );
}

demoSeed()
  .then(() => process.exit(0))
  .catch((error: any) => {
    logger.error({ error: error.message }, 'Demo seed failed');
    process.exit(1);
  });
