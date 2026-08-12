import sequelize from '../models/sequelize';
import { Template, VoiceProfile } from '../models';
import { logger } from '../utils/logger';

const templates = [
  {
    name: 'День на даче',
    description: 'Тёплые моменты загородной жизни: шашлыки, цветы, закаты и семейные посиделки.',
    tone: 'warm',
    defaultDurationSeconds: 4,
    promptTemplate: `Создай тёплый сценарий о семейном дне на даче.
Тон: тёплый, ностальгический.
Используй описания природы, уюта, семейного тепла.
Акцент на простых радостях: чай на веранде, вечерний костёр, игры на лужайке.`,
  },
  {
    name: 'Первый день в школе',
    description: 'Волнующий праздник: букеты, форма, первый звонок и гордые родители.',
    tone: 'solemn',
    defaultDurationSeconds: 5,
    promptTemplate: `Создай торжественный сценарий о первом дне в школе.
Тон: торжественный, трогательный.
Акцент на важности момента, взрослении, гордости родителей.
Добавь нотку волнения и ожидания нового этапа.`,
  },
  {
    name: 'Переезд',
    description: 'Новый дом, новые соседи, коробки и начало новой главы в жизни семьи.',
    tone: 'warm',
    defaultDurationSeconds: 4,
    promptTemplate: `Создай сценарий о переезде семьи в новый дом.
Тон: тёплый, с ноткой приключения.
Акцент на единстве семьи, поддержке друг друга, новых возможностях.
Покажи, как пустой дом наполняется любовью.`,
  },
  {
    name: 'День рождения',
    description: 'Торт, свечи, подарки и счастливые лица именинника.',
    tone: 'warm',
    defaultDurationSeconds: 4,
    promptTemplate: `Создай праздничный сценарий для дня рождения.
Тон: радостный, тёплый.
Акцент на улыбках, сюрпризах, семейном тепле и традициях.`,
  },
  {
    name: 'Новый год',
    description: 'Ёлка, гирлянды, подарки и волшебство зимней сказки.',
    tone: 'warm',
    defaultDurationSeconds: 4,
    promptTemplate: `Создай волшебный сценарий о новогоднем празднике.
Тон: сказочный, тёплый.
Акцент на чуде, семейных традициях, ожидании праздника и радости подарков.`,
  },
  {
    name: 'Письмо в будущее',
    description: 'Запись видео-послания себе и близким через год. Капсула времени.',
    tone: 'solemn',
    defaultDurationSeconds: 5,
    promptTemplate: `Создай трогательный сценарий "Письмо в будущее".
Тон: глубокий, искренний, философский.
Акцент на ценности момента, мечтах, обещаниях себе и близким.
Текст должен звучать как послание через время.`,
  },
  {
    name: 'Наше путешествие',
    description: 'Фото из отпуска: море, горы, новые города и семейные приключения.',
    tone: 'warm',
    defaultDurationSeconds: 4,
    promptTemplate: `Создай сценарий о семейном путешествии.
Тон: вдохновляющий, радостный.
Акцент на новых открытиях, совместных приключениях, красивых пейзажах.
Покажи, как путешествия объединяют семью.`,
  },
  {
    name: 'Просто любим',
    description: 'Повседневные моменты счастья: завтраки, прогулки, объятия.',
    tone: 'warm',
    defaultDurationSeconds: 3,
    promptTemplate: `Создай сценарий о простых, но важных семейных моментах.
Тон: нежный, тёплый, сокровенный.
Акцент на мелочах: утренний кофе, совместный ужин, объятия перед сном.
Покажи красоту в повседневности.`,
  },
];

const voiceProfiles = [
  { name: 'Елена (тёплый)', gender: 'female' as const, emotion: 'warm', apiVoiceId: 'ru-RU-DariyaNeural' },
  { name: 'Мария (спокойный)', gender: 'female' as const, emotion: 'calm', apiVoiceId: 'ru-RU-SvetlanaNeural' },
  { name: 'Алексей (тёплый)', gender: 'male' as const, emotion: 'warm', apiVoiceId: 'ru-RU-DmitryNeural' },
  { name: 'Иван (спокойный)', gender: 'male' as const, emotion: 'calm', apiVoiceId: 'ru-RU-MaximNeural' },
];

async function seed() {
  try {
    await sequelize.sync({ force: false });
    logger.info('Database synced');

    // Seed templates
    for (const template of templates) {
      const [created] = await Template.findOrCreate({
        where: { name: template.name },
        defaults: template,
      });
      if (created) {
        logger.info({ templateName: template.name }, 'Template seeded');
      }
    }

    // Seed voice profiles
    for (const profile of voiceProfiles) {
      const [created] = await VoiceProfile.findOrCreate({
        where: { name: profile.name },
        defaults: profile,
      });
      if (created) {
        logger.info({ profileName: profile.name }, 'Voice profile seeded');
      }
    }

    logger.info('Seed completed successfully');
    process.exit(0);
  } catch (error: any) {
    logger.error({ error: error.message }, 'Seed failed');
    process.exit(1);
  }
}

seed();