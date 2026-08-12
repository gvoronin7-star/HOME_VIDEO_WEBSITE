import { Router } from 'express';
import { z } from 'zod';
import { storyController } from '../controllers/story.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { uploadPhotos } from '../middleware/upload.middleware';
import { validate } from '../middleware/validate.middleware';
import { generationLimiter } from '../middleware/rateLimit.middleware';
import { config } from '../config';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

const storyIdParams = z.object({
  id: z.string().uuid('Некорректный идентификатор истории'),
});

/**
 * Control characters, which have no place in a spoken caption and would corrupt
 * the caption file handed to FFmpeg. Everything below 0x20 except tab, newline and
 * carriage return (those are normalised to spaces at render time), plus DEL.
 *
 * An earlier revision also rejected `$`, backtick, `;`, `\`, `"` and `'`. That was a
 * mitigation for finding S1, back when captions were interpolated into a shell
 * command string. S1 is now fixed at the root — FFmpeg is invoked with an argument
 * array and no shell, and the caption reaches `drawtext` through a file instead of
 * the filtergraph — so the ban was lifted: it blocked ordinary punctuation
 * (quotation marks, apostrophes) that narration legitimately needs.
 */
const CONTROL_CHARS = new RegExp('[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]');

const updateSlidesSchema = z.object({
  params: storyIdParams,
  body: z.object({
    slides: z
      .array(
        z.object({
          id: z.string().uuid('Некорректный идентификатор кадра'),
          orderIndex: z.number().int().min(0, 'Порядок не может быть отрицательным'),
          caption: z
            .string()
            .max(500, 'Текст кадра не длиннее 500 символов')
            .refine((value) => !CONTROL_CHARS.test(value), {
              message: 'Текст кадра содержит недопустимые символы',
            }),
          // Acts as a minimum hold time: if the narration is longer, the slide is
          // shown for as long as the narration lasts.
          durationSeconds: z
            .number()
            .int()
            .min(1, 'Минимум 1 секунда')
            .max(30, 'Максимум 30 секунд'),
          isKeyFrame: z.boolean(),
        })
      )
      .min(1, 'Нужен хотя бы один кадр')
      .max(config.limits.maxPhotos, `Не больше ${config.limits.maxPhotos} кадров`),
  }),
});

const storyIdSchema = z.object({ params: storyIdParams });

// Create a new story with photos. Rate limited before the upload middleware so a
// flood is rejected without first buffering photos into memory.
router.post(
  '/',
  generationLimiter,
  uploadPhotos.array('photos', config.limits.maxPhotos),
  storyController.create
);

// Get all stories for user
router.get('/', storyController.getAll);

// Get story by ID
router.get('/:id', validate(storyIdSchema), storyController.getById);

// Get story generation status
router.get('/:id/status', validate(storyIdSchema), storyController.getStatus);

// Update slides order/captions
router.put('/:id/slides', validate(updateSlidesSchema), storyController.updateSlides);

// Start generation (script → TTS → video → PDF → QR). Paid API calls and minutes
// of CPU per request, so it shares the expensive-work limiter.
router.post('/:id/generate', generationLimiter, validate(storyIdSchema), storyController.generate);

// Quick preview of the first few slides, rendered without narration
router.post('/:id/preview', generationLimiter, validate(storyIdSchema), storyController.preview);

// Delete story
router.delete('/:id', validate(storyIdSchema), storyController.delete);

export default router;
