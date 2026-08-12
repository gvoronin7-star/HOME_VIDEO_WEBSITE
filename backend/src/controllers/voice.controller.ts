import { Request, Response, NextFunction } from 'express';
import { VoiceProfile } from '../models';
import { bindAll } from '../utils/bindAll';

export class VoiceController {
  constructor() {
    // Handlers are passed to Express by reference, so `this` must be bound.
    bindAll(this);
  }

  /**
   * GET /api/voices
   * Narration voices offered to the user.
   *
   * The VoiceProfile table was seeded but read by nothing, so the interface only
   * offered "male/female" while the ТЗ asks for "warm/calm". This exposes the
   * real profiles so the picker can show them by name.
   */
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const voices = await VoiceProfile.findAll({
        attributes: ['id', 'name', 'gender', 'emotion', 'previewUrl'],
        order: [
          ['gender', 'ASC'],
          ['name', 'ASC'],
        ],
      });

      res.json({
        success: true,
        data: { voices },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const voiceController = new VoiceController();
