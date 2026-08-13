import http from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The LLM and the narration both go through an OpenAI-compatible endpoint, so a
 * local stub can stand in for it. That makes it possible to assert the request
 * contract (finding F1) and the reply handling (finding C6) with no network, no
 * key and no cost.
 */

interface Recorded {
  url: string;
  auth?: string;
  body: any;
}

const recorded: Recorded[] = [];
let llmMode: 'valid' | 'malformed' | 'rate-limited-then-ok' | 'always-500' = 'valid';
let server: http.Server;
let aiService: any;
let ttsService: any;

function chatReply(payload: unknown) {
  return {
    id: 'stub',
    object: 'chat.completion',
    created: 1,
    model: 'gpt-4o-mini',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: JSON.stringify(payload) },
        finish_reason: 'stop',
      },
    ],
    usage: {},
  };
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const isSpeech = req.url?.includes('/audio/speech');
      recorded.push({
        url: req.url!,
        auth: req.headers.authorization,
        body: raw && !isSpeech ? JSON.parse(raw) : raw ? JSON.parse(raw) : null,
      });

      if (isSpeech) {
        const audio = Buffer.alloc(2048, 0x11);
        res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': audio.length });
        res.end(audio);
        return;
      }

      const send = (code: number, body: unknown) => {
        const text = JSON.stringify(body);
        res.writeHead(code, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(text),
        });
        res.end(text);
      };

      const chatCalls = recorded.filter((entry) => entry.url.includes('/chat/completions')).length;

      if (llmMode === 'valid') {
        send(
          200,
          chatReply({
            title: 'Заголовок от модели',
            fullText: 'Полный текст сценария.',
            slides: [{ orderIndex: 0, caption: 'Фраза от модели.', durationSeconds: 5 }],
          }),
        );
      } else if (llmMode === 'malformed') {
        // Valid JSON, wrong shape. This used to throw a TypeError that the
        // catch-all turned into a silent template substitution.
        send(200, chatReply({ headline: 'oops', frames: 'not-an-array' }));
      } else if (llmMode === 'rate-limited-then-ok') {
        if (chatCalls <= 2) send(429, { error: { message: 'Rate limit reached' } });
        else
          send(
            200,
            chatReply({
              title: 'После повторов',
              slides: [{ orderIndex: 0, caption: 'Получилось.' }],
            }),
          );
      } else {
        send(500, { error: { message: 'boom' } });
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;

  process.env.OPENAI_API_KEY = 'stub-key';
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/openai/v1`;
  process.env.TTS_SERVICE = 'openai';
  process.env.TTS_MODEL = 'gpt-4o-mini-tts';
  process.env.TTS_FORMAT = 'mp3';

  aiService = (await import('../src/services/ai.service')).aiService;
  ttsService = (await import('../src/services/tts.service')).ttsService;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// Not a real decodable JPEG — nothing in this test suite decodes it, the stub
// server only records the request body. It stands in for the actual photo
// bytes the real caller (story.controller.ts / generationQueue.ts) would embed.
const TEST_IMAGE_DATA_URI = `data:image/jpeg;base64,${Buffer.from('test-image').toString('base64')}`;

const scriptArgs = {
  images: [{ index: 0, isKeyFrame: true, dataUri: TEST_IMAGE_DATA_URI }],
  templateName: 'День на даче',
  templateDescription: 'Тёплые моменты',
  tone: 'warm',
  targetLanguage: 'ru',
};

describe('script generation (C6)', () => {
  it('uses the model reply and reports it as genuine', async () => {
    llmMode = 'valid';
    recorded.length = 0;

    const result = await aiService.generateScript(scriptArgs);

    expect(result.isFallback).toBe(false);
    expect(result.title).toBe('Заголовок от модели');
    expect(recorded.filter((r) => r.url.includes('/chat/completions'))).toHaveLength(1);
  });

  it('falls back on a malformed reply and says so instead of pretending', async () => {
    llmMode = 'malformed';
    recorded.length = 0;

    const result = await aiService.generateScript(scriptArgs);

    // Callers must be able to tell: canned phrases look like a weak model rather
    // than a failure, and nobody investigates what they cannot see.
    expect(result.isFallback).toBe(true);
    expect(result.slides.length).toBeGreaterThan(0);
    // A bad shape is not transient, so it must not be retried.
    expect(recorded.filter((r) => r.url.includes('/chat/completions'))).toHaveLength(1);
  });

  it('retries a 429 and succeeds', async () => {
    llmMode = 'rate-limited-then-ok';
    recorded.length = 0;

    const result = await aiService.generateScript(scriptArgs);

    expect(result.isFallback).toBe(false);
    expect(result.title).toBe('После повторов');
    expect(recorded.filter((r) => r.url.includes('/chat/completions'))).toHaveLength(3);
  });

  it('gives up after the retry budget and flags the fallback', async () => {
    llmMode = 'always-500';
    recorded.length = 0;

    const result = await aiService.generateScript(scriptArgs);

    expect(result.isFallback).toBe(true);
    expect(recorded.filter((r) => r.url.includes('/chat/completions'))).toHaveLength(3);
  });

  it('sends the actual photo to the model, not a text description', async () => {
    llmMode = 'valid';
    recorded.length = 0;

    await aiService.generateScript(scriptArgs);

    const [{ body }] = recorded.filter((r) => r.url.includes('/chat/completions'));
    const userMessage = body.messages.find((m: any) => m.role === 'user');

    // The old contract sent a plain string describing the photo; the model
    // must now be shown the frame itself.
    expect(Array.isArray(userMessage.content)).toBe(true);
    const imageBlock = userMessage.content.find((part: any) => part.type === 'image_url');
    expect(imageBlock?.image_url?.url).toBe(TEST_IMAGE_DATA_URI);
    // 'low' detail: cheap and plenty for scene/mood captioning (see ai.service.ts).
    expect(imageBlock?.image_url?.detail).toBe('low');
  });
});

describe('speech synthesis (F1)', () => {
  const slides = [
    {
      orderIndex: 0,
      caption: 'Как тепло на душе, когда смотришь на эти кадры.',
      durationSeconds: 4,
    },
    { orderIndex: 1, caption: 'Особенный момент, который хочется помнить.', durationSeconds: 4 },
    { orderIndex: 2, caption: '', durationSeconds: 3 },
  ];

  it('sends the documented request shape', async () => {
    recorded.length = 0;
    await ttsService.synthesizeSlides(slides, 'female', 'warm');

    const speech = recorded.filter((entry) => entry.url.includes('/audio/speech'));
    // No request for the empty caption — nothing to say.
    expect(speech).toHaveLength(2);

    expect(speech[0].url).toBe('/openai/v1/audio/speech');
    expect(speech[0].auth).toBe('Bearer stub-key');
    expect(speech[0].body.model).toBe('gpt-4o-mini-tts');
    expect(speech[0].body.response_format).toBe('mp3');
    expect(speech[0].body.input).toBe(slides[0].caption);
    // gpt-4o-mini-tts honours delivery instructions; tts-1 ignores them.
    expect(speech[0].body.instructions).toBeTypeOf('string');
  });

  it.each([
    ['female', 'warm', 'nova'],
    ['female', 'calm', 'shimmer'],
    ['female', 'solemn', 'sage'],
    ['male', 'warm', 'onyx'],
    ['male', 'calm', 'echo'],
    // 'ironic' is a real story tone that used to fall through to the default.
    ['male', 'ironic', 'fable'],
  ])('maps %s + %s onto the "%s" voice', async (gender, mood, expectedVoice) => {
    recorded.length = 0;

    // A caption unique per case: identical text would be served from the cache and
    // send no request at all.
    await ttsService.synthesizeSlides(
      [{ orderIndex: 0, caption: `Реплика для ${gender} ${mood}.`, durationSeconds: 4 }],
      gender as 'male' | 'female',
      mood,
    );

    const speech = recorded.filter((entry) => entry.url.includes('/audio/speech'));
    expect(speech).toHaveLength(1);
    expect(speech[0].body.voice).toBe(expectedVoice);
  });

  it('caches by text, voice and model so a re-run costs nothing', async () => {
    await ttsService.synthesizeSlides(slides, 'female', 'warm');
    recorded.length = 0;

    await ttsService.synthesizeSlides(slides, 'female', 'warm');

    expect(recorded.filter((entry) => entry.url.includes('/audio/speech'))).toHaveLength(0);
  });

  it('treats the slide duration as a minimum, never truncating narration', async () => {
    const result = await ttsService.synthesizeSlides(
      [{ orderIndex: 0, caption: 'Короткая фраза.', durationSeconds: 9 }],
      'female',
      'warm',
    );

    // A manual "show this longer" must be honoured; a manual "show it for 2s"
    // must not cut a seven-second line.
    expect(result.slides[0].durationSeconds).toBeGreaterThanOrEqual(9);
  });

  it('keeps the synthesised speech even when the duration cannot be measured', async () => {
    // ffprobe is absent in CI, so this exercises the estimate path. Discarding
    // audio we already paid for would be the wrong degradation.
    const result = await ttsService.synthesizeSlides([slides[0]], 'female', 'warm');

    expect(result.slides[0].audioPath).toContain('tts-');
    expect(result.slides[0].durationSeconds).toBeGreaterThanOrEqual(2);
  });
});
