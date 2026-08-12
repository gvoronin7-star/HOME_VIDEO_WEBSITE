import { Request, Response, NextFunction } from 'express';
import { Template } from '../models';
import { logger } from '../utils/logger';
import { bindAll } from '../utils/bindAll';

export class TemplateController {
  constructor() {
    // Handlers are passed to Express by reference, so `this` must be bound.
    bindAll(this);
  }

  /**
   * GET /api/templates
   * Get all available templates.
   */
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const templates = await Template.findAll({
        attributes: ['id', 'name', 'description', 'tone', 'defaultDurationSeconds'],
        order: [['name', 'ASC']],
      });

      res.json({
        success: true,
        data: { templates },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/templates/:id
   * Get template by ID.
   */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const template = await Template.findByPk(req.params.id, {
        attributes: ['id', 'name', 'description', 'tone', 'defaultDurationSeconds', 'promptTemplate'],
      });

      if (!template) {
        return res.status(404).json({
          success: false,
          error: { message: 'Шаблон не найден' },
        });
      }

      res.json({
        success: true,
        data: { template },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const templateController = new TemplateController();