import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from '../config';
import { logger } from '../utils/logger';
import { Story, StorySlide, Template, Task, VoiceProfile } from '../models';
import { aiService } from '../services/ai.service';
import { renderService } from '../services/render.service';
import { ttsService } from '../services/tts.service';
import { pdfService } from '../services/pdf.service';
import { qrService } from '../services/qr.service';
import { storageService } from '../services/storage.service';
import { buildShareUrl } from '../utils/urls';
import { toImageDataUri } from '../utils/imageDataUri';
import { v4 as uuidv4 } from 'uuid';

/**
 * Two Redis connections, on purpose.
 *
 * A BullMQ Worker uses blocking commands and refuses to start unless
 * `maxRetriesPerRequest` is null. But that very setting is what made
 * `queue.add()` hang forever while Redis was down (finding N3): ioredis retried
 * indefinitely and the HTTP request never returned a response at all.
 *
 * So the producer gets its own connection that fails fast — finite retries and
 * `enableOfflineQueue: false`, which rejects commands immediately instead of
 * buffering them until Redis reappears. Both keep reconnecting in the
 * background, so service resumes on its own once Redis is back.
 */
function createConnection(kind: 'producer' | 'worker'): Redis {
  const redis = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    maxRetriesPerRequest: kind === 'worker' ? null : 2,
    enableOfflineQueue: kind === 'worker',
    connectTimeout: 5000,
    // Never returns null: the connection must keep trying so the service
    // recovers by itself when Redis comes back.
    retryStrategy: (attempt: number) => Math.min(attempt * 300, 5000),
  });

  // Debounced: an unreachable Redis emits errors continuously and would
  // otherwise bury every other line in the log.
  let lastErrorLoggedAt = 0;
  redis.on('error', (err: Error) => {
    const now = Date.now();
    if (now - lastErrorLoggedAt < 10000) return;
    lastErrorLoggedAt = now;
    logger.error(
      { connection: kind, error: err.message || 'Redis connection error' },
      'Redis connection error',
    );
  });

  redis.on('connect', () => {
    logger.info({ connection: kind }, 'Redis connected');
  });

  return redis;
}

const producerConnection = createConnection('producer');

export const generationQueue = new Queue('generation', {
  connection: producerConnection as unknown as Redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: 50,
    removeOnFail: 20,
  },
});

/**
 * Enqueue a job, refusing to wait indefinitely.
 *
 * `enableOfflineQueue: false` already makes most failures immediate, but a
 * connection stuck mid-handshake can still stall. This bounds the wait so the
 * caller can answer the client instead of leaving the request open.
 */
export async function enqueueGeneration(
  data: GenerationJobData,
  timeoutMs = 5000,
): Promise<{ jobId: string }> {
  const job = await Promise.race([
    generationQueue.add('generate-story', data, { removeOnFail: 100 }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Queue did not accept the job within ${timeoutMs}ms`)),
        timeoutMs,
      ),
    ),
  ]);

  return { jobId: String(job.id) };
}

export interface GenerationJobData {
  storyId: string;
  userId: string;
  /** Task row to report progress into. Selecting by id avoids updating a stale task. */
  taskId?: string;
}

export interface GenerationJobResult {
  success: boolean;
  videoUrl?: string;
  pdfUrl?: string;
  qrCodeUrl?: string;
  errorMessage?: string;
}

/**
 * Exported so tests can drive the pipeline directly — Redis is intentionally
 * absent in the test environment (see tests/queue-and-storage.test.ts), so
 * there is no other way to exercise this without a live BullMQ worker.
 */
export async function processStoryGeneration(
  jobId: string,
  data: GenerationJobData,
): Promise<GenerationJobResult> {
  logger.info({ jobId, storyId: data.storyId }, 'Worker: starting story generation');

  const story = await Story.findByPk(data.storyId, {
    include: [
      { model: Template, as: 'template' },
      { model: StorySlide, as: 'slides', order: [['orderIndex', 'ASC']] },
      { model: VoiceProfile, as: 'voiceProfile' },
    ],
  });

  if (!story) {
    throw new Error(`Story not found: ${data.storyId}`);
  }

  // Select by id: `generate` creates a new Task on every call, so picking an
  // arbitrary row wrote progress into a stale task while the real one stayed
  // 'queued' forever. The fallback covers jobs enqueued before taskId existed.
  const task = data.taskId
    ? await Task.findByPk(data.taskId)
    : await Task.findOne({
        where: { storyId: data.storyId },
        order: [['createdAt', 'DESC']],
      });

  if (task) {
    await task.update({ status: 'processing', progress: 5 });
  }

  // Step 1: Generate script — but only if the story doesn't have one yet. A
  // story reaching `generate` already `script_ready` got there either from the
  // draft-time fire-and-forget pass in story.controller.ts, or from the user
  // hand-editing captions via PUT /slides. Regenerating unconditionally here
  // silently discarded either — a user who edited the text and clicked
  // "Запустить генерацию" got their edits overwritten by a brand-new AI pass
  // with no warning.
  if (!story.scriptText) {
    logger.info({ storyId: story.id }, 'Worker: step 1 - generating script');
    await story.update({ status: 'script_generating' });
    if (task) await task.update({ progress: 10 });

    try {
      const images = await Promise.all(
        story.slides!.map(async (slide) => ({
          index: slide.orderIndex,
          isKeyFrame: slide.isKeyFrame,
          dataUri: await toImageDataUri(storageService.getFilePath(slide.imageKey)),
        })),
      );

      const script = await aiService.generateScript({
        images,
        templateName: story.template?.name || 'История',
        templateDescription: story.template?.description || '',
        tone: story.tone,
        targetLanguage: 'ru',
      });

      for (const slideData of script.slides) {
        const slide = story.slides?.find((s) => s.orderIndex === slideData.orderIndex);
        if (slide) {
          await slide.update({
            caption: slideData.caption,
            durationSeconds: slideData.durationSeconds,
          });
        }
      }

      await story.update({
        scriptText: script.fullText,
        title: script.title,
        status: 'script_ready',
      });

      // Record whether the text came from the model or from the template mock, so a
      // generic-sounding story can be attributed instead of guessed at.
      if (task) {
        await task.update({
          resultData: { scriptSource: script.isFallback ? 'fallback' : 'llm' },
        });
      }

      logger.info(
        { storyId: story.id, scriptSource: script.isFallback ? 'fallback' : 'llm' },
        'Worker: script generated',
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ storyId: story.id, error: message }, 'Worker: script generation failed');
      await story.update({ status: 'error' });
      if (task) await task.update({ status: 'failed', errorMessage: `Script: ${message}` });
      return { success: false, errorMessage: `Script generation failed: ${message}` };
    }
  } else {
    logger.info(
      { storyId: story.id },
      'Worker: step 1 - reusing existing script (already generated or hand-edited)',
    );
    if (task) {
      await task.update({ progress: 10, resultData: { scriptSource: 'reused' } });
    }
  }

  await story.reload({
    include: [
      { model: Template, as: 'template' },
      { model: StorySlide, as: 'slides', order: [['orderIndex', 'ASC']] },
      { model: VoiceProfile, as: 'voiceProfile' },
    ],
  });

  if (!story.slides || story.slides.length === 0) {
    const errorMsg = 'No slides found after script generation';
    logger.error({ storyId: story.id }, errorMsg);
    await story.update({ status: 'error' });
    if (task) await task.update({ status: 'failed', errorMessage: errorMsg });
    return { success: false, errorMessage: errorMsg };
  }

  // Step 2: Generate TTS
  logger.info({ storyId: story.id }, 'Worker: step 2 - generating TTS');
  await story.update({ status: 'rendering' });
  if (task) await task.update({ progress: 30 });

  let audioPath: string | null = null;
  // orderIndex -> spoken length, used to time each slide to its own line.
  const narratedDurations = new Map<number, number>();

  try {
    const narration = await ttsService.synthesizeSlides(
      story.slides.map((slide) => ({
        orderIndex: slide.orderIndex,
        caption: slide.caption,
        durationSeconds: slide.durationSeconds,
      })),
      story.voiceGender as 'male' | 'female',
      story.tone,
      story.voiceProfile?.apiVoiceId,
    );

    audioPath = narration.audioPath;

    // Persist the measured lengths so the render — and any later re-render —
    // shows every slide for exactly as long as its narration lasts.
    for (const slideNarration of narration.slides) {
      narratedDurations.set(slideNarration.orderIndex, slideNarration.durationSeconds);
      const slide = story.slides.find((s) => s.orderIndex === slideNarration.orderIndex);
      if (slide && slide.durationSeconds !== slideNarration.durationSeconds) {
        await slide.update({ durationSeconds: slideNarration.durationSeconds });
      }
    }

    logger.info(
      {
        storyId: story.id,
        isSpeech: narration.isSpeech,
        totalDurationSeconds: narration.totalDurationSeconds,
      },
      narration.isSpeech
        ? 'Worker: narration synthesised'
        : 'Worker: narration unavailable, silent track used',
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.warn(
      { storyId: story.id, error: message },
      'Worker: TTS failed, continuing without audio',
    );
  }

  // Step 3: Render video
  logger.info({ storyId: story.id }, 'Worker: step 3 - rendering video');
  if (task) await task.update({ progress: 40 });

  try {
    const slideData = story.slides.map((slide) => ({
      imagePath: storageService.getFilePath(slide.imageKey),
      caption: slide.caption,
      // Prefer the measured narration length over the template default.
      durationSeconds: narratedDurations.get(slide.orderIndex) ?? slide.durationSeconds,
    }));

    const renderResult = await renderService.renderVideo({
      slides: slideData,
      audioPath,
      outputFileName: `story-${story.id}.mp4`,
    });

    await story.update({ videoUrl: renderResult.videoUrl });
    logger.info({ storyId: story.id }, 'Worker: video rendered');
    if (task) await task.update({ progress: 80 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ storyId: story.id, error: message }, 'Worker: video rendering failed');
    await story.update({ status: 'error' });
    if (task) await task.update({ status: 'failed', errorMessage: `Video: ${message}` });
    return { success: false, errorMessage: `Video rendering failed: ${message}` };
  }

  // Step 4: Generate QR + PDF
  logger.info({ storyId: story.id }, 'Worker: step 4 - generating QR and PDF');
  if (task) await task.update({ progress: 85 });

  try {
    // Reuse an existing token across re-renders (editing slides and generating
    // again must not silently break a link the user already shared) — mint one
    // only the first time, or after an explicit revoke set it back to null.
    const shareToken = story.shareToken || uuidv4();
    const publicUrl = buildShareUrl(shareToken);
    const qrResult = await qrService.generateQRCode(publicUrl);

    const pdfResult = await pdfService.generatePDFAlbum({
      title: story.title,
      templateName: story.template?.name || 'История',
      slides: story.slides.map((slide) => ({
        imageUrl: slide.imageUrl,
        imagePath: storageService.getFilePath(slide.imageKey),
        caption: slide.caption,
        orderIndex: slide.orderIndex,
      })),
      qrCodePath: qrResult.key ? storageService.getFilePath(qrResult.key) : undefined,
    });

    await story.update({
      status: 'ready',
      pdfUrl: pdfResult.pdfUrl,
      qrCodeUrl: qrResult.imageUrl,
      publicUrl,
      shareToken,
    });

    logger.info({ storyId: story.id }, 'Worker: outputs generated');
    if (task) await task.update({ status: 'completed', progress: 100, completedAt: new Date() });

    return {
      success: true,
      videoUrl: story.videoUrl || undefined,
      pdfUrl: pdfResult.pdfUrl,
      qrCodeUrl: qrResult.imageUrl,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ storyId: story.id, error: message }, 'Worker: output generation failed');
    await story.update({ status: 'error' });
    if (task) await task.update({ status: 'failed', errorMessage: `Output: ${message}` });
    return { success: false, errorMessage: `Output generation failed: ${message}` };
  }
}

// === LAZY WORKER (avoids crash when Redis is unavailable) ===
let _worker: Worker | null = null;

export function getWorker(): Worker | null {
  if (_worker) return _worker;

  try {
    _worker = new Worker(
      'generation',
      async (job) => {
        const data = job.data as GenerationJobData;
        return processStoryGeneration(String(job.id), data);
      },
      {
        // Its own connection: blocking commands need maxRetriesPerRequest: null,
        // which the producer must not use (see createConnection).
        connection: createConnection('worker') as unknown as Redis,
        concurrency: 2,
        limiter: { max: 5, duration: 60000 },
      },
    );

    _worker.on('completed', (job) => {
      logger.info({ jobId: job.id, storyId: job.data.storyId }, 'Worker: job completed');
    });

    _worker.on('failed', (job, err) => {
      logger.error(
        {
          jobId: job?.id || 'unknown',
          storyId: job?.data?.storyId || 'unknown',
          error: err.message,
        },
        'Worker: job failed',
      );
    });

    _worker.on('error', (err) => {
      logger.error({ error: err.message }, 'Worker: error');
    });
  } catch (err: any) {
    logger.error({ error: err.message }, 'Worker creation failed');
    return null;
  }

  return _worker;
}

export default generationQueue;
