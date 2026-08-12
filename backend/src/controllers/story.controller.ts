import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { Story, StorySlide, Template, Task } from '../models';
import { storageService } from '../services/storage.service';
import { aiService } from '../services/ai.service';
import { ttsService } from '../services/tts.service';
import { renderService } from '../services/render.service';
import { pdfService } from '../services/pdf.service';
import { qrService } from '../services/qr.service';
import { logger } from '../utils/logger';
import path from 'path';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { enqueueGeneration } from '../queues/generationQueue';
import { bindAll } from '../utils/bindAll';
import { buildShareUrl } from '../utils/urls';
import { collectStoryArtefacts } from '../utils/storyArtefacts';

export class StoryController {
  constructor() {
    // Handlers are passed to Express by reference, so `this` must be bound.
    bindAll(this);
  }

  /**
   * POST /api/stories
   * Create a new story with uploaded photos.
   */
  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const files = req.files as Express.Multer.File[];
      const { templateId, title, tone, voiceGender } = req.body;

      if (!files || files.length === 0) {
        return res.status(422).json({
          success: false,
          error: { message: 'Загрузите хотя бы одно фото' },
        });
      }

      // Validate template
      const template = await Template.findByPk(templateId);
      if (!template) {
        return res.status(404).json({
          success: false,
          error: { message: 'Шаблон не найден' },
        });
      }

      // Save photos to storage
      const savedSlides = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        // Optimize image with sharp
        const optimizedBuffer = await sharp(file.buffer)
          .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();

        const { url, key } = await storageService.saveFile(
          optimizedBuffer,
          file.originalname,
          'photos'
        );

        savedSlides.push({
          imageUrl: url,
          imageKey: key,
          orderIndex: i,
          isKeyFrame: i === 0, // First photo is key by default
        });
      }

      // Create story
      const story = await Story.create({
        userId: req.user!.id,
        title: title || `История: ${template.name}`,
        templateId: template.id,
        status: 'draft',
        tone: tone || template.tone,
        voiceGender: voiceGender || 'female',
      });

      // Create slides
      for (const slide of savedSlides) {
        await StorySlide.create({
          storyId: story.id,
          imageUrl: slide.imageUrl,
          imageKey: slide.imageKey,
          orderIndex: slide.orderIndex,
          isKeyFrame: slide.isKeyFrame,
          durationSeconds: template.defaultDurationSeconds,
        });
      }

      logger.info({ storyId: story.id, slidesCount: savedSlides.length }, 'Story created');

      // Start script generation in background (non-blocking)
      this.generateScript(story.id).catch((err) => {
        logger.error({ error: err.message, storyId: story.id }, 'Background script generation failed');
      });

      res.status(201).json({
        success: true,
        data: {
          story: {
            id: story.id,
            title: story.title,
            status: story.status,
            slidesCount: savedSlides.length,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/stories
   * Get all stories for current user.
   */
  async getAll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const stories = await Story.findAll({
        where: { userId: req.user!.id },
        include: [
          {
            model: Template,
            as: 'template',
            attributes: ['id', 'name', 'description', 'tone'],
          },
          {
            model: StorySlide,
            as: 'slides',
            attributes: ['id', 'imageUrl', 'orderIndex', 'isKeyFrame'],
          },
        ],
        order: [['createdAt', 'DESC']],
      });

      res.json({
        success: true,
        data: { stories },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/stories/:id
   * Get story by ID with all details.
   */
  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const story = await Story.findOne({
        where: { id: req.params.id, userId: req.user!.id },
        include: [
          {
            model: Template,
            as: 'template',
            attributes: ['id', 'name', 'description', 'tone'],
          },
          {
            model: StorySlide,
            as: 'slides',
            order: [['orderIndex', 'ASC']],
          },
        ],
      });

      if (!story) {
        return res.status(404).json({
          success: false,
          error: { message: 'История не найдена' },
        });
      }

      res.json({
        success: true,
        data: { story },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/stories/:id/slides
   * Update slides order, captions, etc.
   */
  async updateSlides(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { slides } = req.body; // Array of { id, orderIndex, caption, durationSeconds, isKeyFrame }

      const story = await Story.findOne({
        where: { id: req.params.id, userId: req.user!.id },
      });

      if (!story) {
        return res.status(404).json({
          success: false,
          error: { message: 'История не найдена' },
        });
      }

      for (const slideData of slides) {
        await StorySlide.update(
          {
            orderIndex: slideData.orderIndex,
            caption: slideData.caption,
            durationSeconds: slideData.durationSeconds,
            isKeyFrame: slideData.isKeyFrame,
          },
          { where: { id: slideData.id, storyId: story.id } }
        );
      }

      logger.info({ storyId: story.id }, 'Slides updated');

      res.json({
        success: true,
        data: { message: 'Слайды обновлены' },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/stories/:id/generate
   * Generate script, TTS, and render video via BullMQ queue.
   */
  async generate(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const story = await Story.findOne({
        where: { id: req.params.id, userId: req.user!.id },
        include: [
          { model: Template, as: 'template' },
          { model: StorySlide, as: 'slides', order: [['orderIndex', 'ASC']] },
        ],
      });

      if (!story) {
        return res.status(404).json({
          success: false,
          error: { message: 'История не найдена' },
        });
      }

      // Reject only while work is actually in flight. 'script_ready' is a
      // resting state — the script exists and rendering has not started, which
      // is precisely when the user launches generation.
      if (['script_generating', 'rendering'].includes(story.status)) {
        return res.status(409).json({
          success: false,
          error: { message: 'Генерация уже запущена' },
        });
      }

      // Create a Task record for tracking
      const task = await Task.create({
        storyId: story.id,
        type: 'render_video',
        status: 'pending',
        progress: 0,
      });

      // Enqueue with a bounded wait. Previously an unavailable Redis left this
      // request open forever and the user stared at "Запуск..." indefinitely.
      let jobId: string;
      try {
        ({ jobId } = await enqueueGeneration({
          storyId: story.id,
          userId: story.userId,
          taskId: task.id,
        }));
      } catch (queueError: unknown) {
        const message =
          queueError instanceof Error ? queueError.message : 'Unknown queue error';

        await task.update({
          status: 'failed',
          errorMessage: 'Очередь задач недоступна. Проверьте, что Redis запущен.',
        });

        logger.error(
          { storyId: story.id, taskId: task.id, error: message },
          'Failed to enqueue generation job — queue unavailable'
        );

        return res.status(503).json({
          success: false,
          error: {
            message:
              'Сервис генерации временно недоступен: очередь задач не отвечает. Попробуйте позже.',
          },
        });
      }

      await task.update({
        status: 'queued',
        progress: 0,
      });

      logger.info({ storyId: story.id, taskId: task.id, jobId }, 'Generation job added to queue');

      res.json({
        success: true,
        data: {
          message: 'Генерация поставлена в очередь',
          storyId: story.id,
          taskId: task.id,
          status: 'queued',
          jobId,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/stories/:id/preview
   * Render a short preview of the first slides.
   *
   * Deliberately synchronous and without narration. A preview is a visual check
   * that must come back in seconds, so it skips TTS entirely and reuses the
   * captions and durations already stored. Running it inline avoids a second job
   * type in the queue; FFmpeg is spawned asynchronously, so the event loop stays
   * free while the request is open.
   */
  async preview(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const story = await Story.findOne({
        where: { id: req.params.id, userId: req.user!.id },
        include: [{ model: StorySlide, as: 'slides' }],
      });

      if (!story) {
        return res.status(404).json({
          success: false,
          error: { message: 'История не найдена' },
        });
      }

      const slides = (story.slides || [])
        .slice()
        .sort((a, b) => a.orderIndex - b.orderIndex);

      if (slides.length === 0) {
        return res.status(409).json({
          success: false,
          error: { message: 'В истории нет кадров' },
        });
      }

      if (!slides.some((slide) => (slide.caption || '').trim())) {
        return res.status(409).json({
          success: false,
          error: {
            message: 'Сначала нужно создать сценарий — у кадров пока нет текста',
          },
        });
      }

      const result = await renderService.renderPreview({
        slides: slides.map((slide) => ({
          imagePath: storageService.getFilePath(slide.imageKey),
          caption: slide.caption,
          durationSeconds: slide.durationSeconds,
        })),
        audioPath: null,
        outputFileName: `preview-${story.id}.mp4`,
      });

      logger.info({ storyId: story.id }, 'Preview rendered');

      res.json({
        success: true,
        data: {
          previewUrl: result.videoUrl,
          slidesCount: Math.min(slides.length, 4),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/stories/:id/status
   * Get story generation status and task info (for polling).
   */
  async getStatus(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const story = await Story.findOne({
        where: { id: req.params.id, userId: req.user!.id },
        attributes: ['id', 'status', 'videoUrl', 'pdfUrl', 'qrCodeUrl', 'publicUrl', 'scriptText', 'updatedAt'],
        include: [
          {
            model: Task,
            as: 'tasks',
            order: [['createdAt', 'DESC']],
            limit: 1,
            attributes: ['id', 'status', 'progress', 'errorMessage', 'resultData', 'createdAt', 'completedAt'],
          },
        ],
      });

      if (!story) {
        return res.status(404).json({
          success: false,
          error: { message: 'История не найдена' },
        });
      }

      const task = story.tasks?.[0] || null;

      res.json({
        success: true,
        data: {
          story: {
            id: story.id,
            status: story.status,
            videoUrl: story.videoUrl,
            pdfUrl: story.pdfUrl,
            qrCodeUrl: story.qrCodeUrl,
            publicUrl: story.publicUrl,
            scriptText: story.scriptText,
            updatedAt: story.updatedAt,
          },
          task: task
            ? {
                id: task.id,
                status: task.status,
                progress: task.progress,
                errorMessage: task.errorMessage,
                resultData: task.resultData,
                createdAt: task.createdAt,
                completedAt: task.completedAt,
              }
            : null,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/stories/:id
   * Delete a story and its files.
   */
  async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const story = await Story.findOne({
        where: { id: req.params.id, userId: req.user!.id },
        include: [{ model: StorySlide, as: 'slides' }],
      });

      if (!story) {
        return res.status(404).json({
          success: false,
          error: { message: 'История не найдена' },
        });
      }

      // Shared with the retention job so the two lists cannot drift apart.
      const { required, optional } = collectStoryArtefacts(story);

      for (const key of required) {
        await storageService.deleteFile(key);
      }
      for (const key of optional) {
        await storageService.deleteFile(key, { missingOk: true });
      }

      await story.destroy();
      logger.info({ storyId: story.id }, 'Story deleted');

      res.json({
        success: true,
        data: { message: 'История удалена' },
      });
    } catch (error) {
      next(error);
    }
  }

  // ===== Private Methods =====

  /**
   * Generate script for a story.
   */
  private async generateScript(storyId: string): Promise<void> {
    try {
      const story = await Story.findByPk(storyId, {
        include: [
          { model: Template, as: 'template' },
          { model: StorySlide, as: 'slides', order: [['orderIndex', 'ASC']] },
        ],
      });

      if (!story || !story.slides) return;

      await story.update({ status: 'script_generating' });

      const imageDescriptions = story.slides.map((slide) => ({
        index: slide.orderIndex,
        description: `Фото (${path.basename(slide.imageKey)})`,
        isKeyFrame: slide.isKeyFrame,
      }));

      const script = await aiService.generateScript({
        imageDescriptions,
        templateName: story.template!.name,
        templateDescription: story.template!.description,
        tone: story.tone,
        targetLanguage: 'ru',
      });

      // Update slides with captions
      for (const slideData of script.slides) {
        const slide = story.slides.find((s) => s.orderIndex === slideData.orderIndex);
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

      logger.info({ storyId }, 'Script generated successfully');
    } catch (error: any) {
      logger.error({ error: error.message, storyId }, 'Script generation failed');
      await Story.update({ status: 'error' }, { where: { id: storyId } });
    }
  }

  /**
   * Full pipeline: script → TTS → render → PDF → QR.
   */
  private async processFullGeneration(storyId: string): Promise<void> {
    try {
      // Step 1: Generate script
      await this.generateScript(storyId);
      const story = await Story.findByPk(storyId, {
        include: [{ model: StorySlide, as: 'slides', order: [['orderIndex', 'ASC']] }],
      });

      if (!story || !story.slides || story.status === 'error') {
        throw new Error('Script generation failed');
      }

      await story.update({ status: 'rendering' });

      // Step 2: Generate TTS
      let audioPath: string | null = null;
      if (story.scriptText) {
        const ttsResult = await ttsService.synthesizeSpeech({
          text: story.scriptText,
          voice: story.voiceGender as 'male' | 'female',
        });
        if (ttsResult.audioUrl) {
          audioPath = path.resolve(
            storageService.getFilePath('audio/' + ttsResult.audioUrl.split('/').pop()!)
          );
        }
      }

      // Step 3: Render video
      const slideData = story.slides.map((slide) => ({
        imagePath: storageService.getFilePath(slide.imageKey),
        caption: slide.caption,
        durationSeconds: slide.durationSeconds,
      }));

      const renderResult = await renderService.renderVideo({
        slides: slideData,
        audioPath,
        outputFileName: `story-${storyId}.mp4`,
      });

      await story.update({ videoUrl: renderResult.videoUrl });

      // Step 4: Generate QR code
      const publicUrl = buildShareUrl(storyId);
      const qrResult = await qrService.generateQRCode(publicUrl);

      // Step 5: Generate PDF album
      const pdfResult = await pdfService.generatePDFAlbum({
        title: story.title,
        templateName: story.template?.name || 'История',
        slides: story.slides.map((slide) => ({
          imageUrl: slide.imageUrl,
          imagePath: storageService.getFilePath(slide.imageKey),
          caption: slide.caption,
          orderIndex: slide.orderIndex,
        })),
        qrCodePath: qrResult.key
          ? storageService.getFilePath(qrResult.key)
          : undefined,
      });

      await story.update({
        status: 'ready',
        pdfUrl: pdfResult.pdfUrl,
        qrCodeUrl: qrResult.imageUrl,
        publicUrl,
      });

      logger.info({ storyId }, 'Full generation completed successfully');
    } catch (error: any) {
      logger.error({ error: error.message, storyId }, 'Full generation failed');
      await Story.update({ status: 'error' }, { where: { id: storyId } });
    }
  }
}

export const storyController = new StoryController();