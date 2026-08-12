import { Request, Response, NextFunction } from 'express';
import { Story } from '../models';
import { StorySlide } from '../models/StorySlide';
import { Template } from '../models';
import { storageService } from '../services/storage.service';
import { logger } from '../utils/logger';
import { bindAll } from '../utils/bindAll';

export class ShareController {
  constructor() {
    // Handlers are passed to Express by reference, so `this` must be bound.
    bindAll(this);
  }

  /**
   * GET /api/share/:id
   * Public view of a story.
   */
  async getPublicStory(req: Request, res: Response, next: NextFunction) {
    try {
      const story = await Story.findOne({
        where: { id: req.params.id, status: 'ready' },
        include: [
          { model: Template, as: 'template', attributes: ['id', 'name', 'description'] },
          { model: StorySlide, as: 'slides', order: [['orderIndex', 'ASC']] },
        ],
      });

      if (!story) {
        return res.status(404).json({
          success: false,
          error: { message: 'История не найдена или ещё не готова' },
        });
      }

      // Don't expose user info in public share
      res.json({
        success: true,
        data: {
          story: {
            id: story.id,
            title: story.title,
            videoUrl: story.videoUrl,
            pdfUrl: story.pdfUrl,
            qrCodeUrl: story.qrCodeUrl,
            slides: story.slides?.map((s) => ({
              imageUrl: s.imageUrl,
              caption: s.caption,
              orderIndex: s.orderIndex,
            })),
            template: story.template,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const shareController = new ShareController();