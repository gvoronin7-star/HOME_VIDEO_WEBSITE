import { z } from 'zod';
import { config } from '../config';
import { logger } from '../utils/logger';
import OpenAI from 'openai';

interface ScriptSlide {
  orderIndex: number;
  caption: string;
  durationSeconds: number;
  imageDescription: string;
}

interface ScriptResult {
  slides: ScriptSlide[];
  fullText: string;
  title: string;
  /**
   * True when the template mock was used instead of the model. Callers must be
   * able to tell: silently serving canned phrases looks like a weak AI rather
   * than a failure, and nobody investigates what they cannot see.
   */
  isFallback: boolean;
}

/**
 * The model is asked for JSON but is not obliged to return this shape. Validating
 * turns a malformed reply into a logged, attributable failure instead of a
 * TypeError swallowed by the catch-all below.
 */
const scriptResponseSchema = z.object({
  title: z.string().min(1).optional(),
  fullText: z.string().optional(),
  slides: z
    .array(
      z.object({
        orderIndex: z.number().int().min(0),
        caption: z.string().min(1),
        durationSeconds: z.number().positive().optional(),
        imageDescription: z.string().optional(),
      }),
    )
    .min(1),
});

/** Errors worth another attempt: rate limits, timeouts, upstream hiccups. */
function isRetryable(error: any): boolean {
  const status = error?.status ?? error?.response?.status;
  if (status === 429 || (typeof status === 'number' && status >= 500)) return true;
  const code = error?.code;
  return code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ECONNREFUSED';
}

export class AIService {
  private openai: OpenAI | null = null;

  constructor() {
    if (config.openai.apiKey) {
      this.openai = new OpenAI({
        apiKey: config.openai.apiKey,
        // Empty baseUrl => official OpenAI. An OpenAI-compatible gateway such as
        // ProxyAPI needs only this setting, so the script and the narration share
        // one key and one endpoint.
        ...(config.openai.baseUrl ? { baseURL: config.openai.baseUrl } : {}),
        // The SDK retries twice by default. Combined with the explicit loop in
        // generateScript that meant up to nine requests per generation, hammering
        // an endpoint that had just rate-limited us. Retries are handled in one
        // place instead, so the budget is exactly what the code says it is.
        maxRetries: 0,
      });
      logger.info(
        { model: config.openai.model, endpoint: config.openai.baseUrl || 'api.openai.com' },
        'AI service configured',
      );
    } else {
      logger.warn('OpenAI API key not configured. AI service will use mock mode.');
    }
  }

  /**
   * Generate a script for a story based on image descriptions, template, and tone.
   */
  async generateScript(params: {
    imageDescriptions: Array<{ index: number; description: string; isKeyFrame: boolean }>;
    templateName: string;
    templateDescription: string;
    tone: string;
    targetLanguage: string;
  }): Promise<ScriptResult> {
    const { imageDescriptions, templateName, templateDescription, tone, targetLanguage } = params;

    if (!this.openai) {
      logger.warn(
        'No LLM key configured — the story text will be generic template phrases, not AI-written',
      );
      return {
        ...this.mockScriptGeneration(imageDescriptions, templateName, tone),
        isFallback: true,
      };
    }

    const prompt = this.buildScriptPrompt({
      imageDescriptions,
      templateName,
      templateDescription,
      tone,
      targetLanguage,
    });

    // Up to 3 attempts with exponential backoff. The ТЗ requires handling 429 and
    // timeouts with retries; previously a 429 slept 2s and then gave up on the mock.
    const maxAttempts = 3;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.requestScript(prompt, targetLanguage, templateName);
      } catch (error: any) {
        lastError = error;

        if (isRetryable(error) && attempt < maxAttempts) {
          const delayMs = 1000 * 2 ** (attempt - 1);
          logger.warn(
            { attempt, maxAttempts, delayMs, status: error?.status, error: error?.message },
            'LLM request failed, retrying',
          );
          await this.delay(delayMs);
          continue;
        }
        break;
      }
    }

    logger.error(
      { error: (lastError as any)?.message, status: (lastError as any)?.status },
      'LLM script generation failed after retries — FALLING BACK to the template mock. ' +
        'The story text will be generic, this is not a model quality issue.',
    );

    const mock = this.mockScriptGeneration(imageDescriptions, templateName, tone);
    return { ...mock, isFallback: true };
  }

  /** One attempt at the model, with the reply validated before use. */
  private async requestScript(
    prompt: string,
    targetLanguage: string,
    templateName: string,
  ): Promise<ScriptResult> {
    if (!this.openai) throw new Error('LLM client is not configured');

    {
      logger.info('Generating script with LLM...');
      const response = await this.openai.chat.completions.create({
        model: config.openai.model,
        messages: [
          {
            role: 'system',
            content: `Ты — креативный сценарист семейных видео. Твоя задача — написать тёплый, 
            эмоциональный сценарий для видео из семейных фотографий. 
            Пиши на русском языке (${targetLanguage}). 
            Важно: текст должен быть искренним, живым, без пафоса. 
            Используй простые, понятные фразы. 
            Длина каждого кадра: 15-25 слов. 
            Ответ выдай строго в формате JSON.`,
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.8,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from LLM');
      }

      // Validate before touching the data: `parsed.slides.map(...)` on an
      // unexpected shape threw a TypeError that the old catch-all turned into a
      // silent mock substitution.
      const parsed = scriptResponseSchema.parse(JSON.parse(content));

      logger.info({ slides: parsed.slides.length }, 'Script generated successfully');

      return {
        slides: parsed.slides.map((s) => ({
          orderIndex: s.orderIndex,
          caption: s.caption,
          durationSeconds: s.durationSeconds || 4,
          imageDescription: s.imageDescription || '',
        })),
        fullText: parsed.fullText || parsed.slides.map((s) => s.caption).join(' '),
        title: parsed.title || templateName,
        isFallback: false,
      };
    }
  }

  private buildScriptPrompt(params: {
    imageDescriptions: Array<{ index: number; description: string; isKeyFrame: boolean }>;
    templateName: string;
    templateDescription: string;
    tone: string;
    targetLanguage: string;
  }): string {
    const { imageDescriptions, templateName, templateDescription, tone } = params;

    const imagesText = imageDescriptions
      .map(
        (img) =>
          `Кадр ${img.index + 1}: ${img.description}${img.isKeyFrame ? ' [КЛЮЧЕВОЙ КАДР]' : ''}`,
      )
      .join('\n');

    return `
Создай сценарий для видео по следующему шаблону:

Шаблон: "${templateName}"
Описание: "${templateDescription}"
Тон: "${tone}"

Последовательность кадров (фотографий):
${imagesText}

Требования к сценарию:
- Для каждого кадра напиши текст озвучки (15-25 слов).
- Общий тон: ${tone}, тёплый, душевный.
- Ключевые кадры (помечены) должны иметь более насыщенный текст.
- Придумай название для видео.

Формат ответа JSON:
{
  "title": "Название видео",
  "fullText": "Полный текст сценария (все кадры подряд)",
  "slides": [
    {
      "orderIndex": 0,
      "caption": "Текст для первого кадра",
      "durationSeconds": 4,
      "imageDescription": "краткое описание кадра"
    }
  ]
}
`;
  }

  /** Canned phrases. Callers stamp `isFallback: true` so this is never mistaken
   *  for model output. */
  private mockScriptGeneration(
    imageDescriptions: Array<{ index: number; description: string; isKeyFrame: boolean }>,
    templateName: string,
    tone: string,
  ): Omit<ScriptResult, 'isFallback'> {
    const tonePrefixes: Record<string, string[]> = {
      warm: [
        'Как тепло на душе, когда смотришь на эти кадры...',
        'В этом мгновении столько любви и счастья...',
        'Каждая фотография хранит частичку нашей души...',
      ],
      ironic: [
        'Ну кто бы мог подумать, что этот момент станет историей...',
        'Смешно вспоминать, как всё начиналось...',
        'А ведь могли и не сфотографировать этот забавный случай...',
      ],
      solemn: [
        'Этот день навсегда останется в истории нашей семьи...',
        'Торжественный момент, полный гордости и радости...',
        'Мы стали свидетелями важного события...',
      ],
    };

    const prefixes = tonePrefixes[tone] || tonePrefixes.warm;
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];

    const slides = imageDescriptions.map((img, i) => ({
      orderIndex: i,
      caption:
        i === 0
          ? `${prefix} ${img.description} — это начало нашей удивительной истории.`
          : img.isKeyFrame
            ? `Особенный момент: ${img.description}. Это фото хранит столько эмоций и воспоминаний!`
            : `А вот ещё один прекрасный кадр: ${img.description}. Каждое фото — это целая история.`,
      durationSeconds: img.isKeyFrame ? 5 : 4,
      imageDescription: img.description,
    }));

    const fullText = slides.map((s) => s.caption).join(' ');

    return {
      slides,
      fullText,
      title: `${templateName}: История в фотографиях`,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const aiService = new AIService();
