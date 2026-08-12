import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { User } from '../models';
import { logger } from '../utils/logger';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
  };
}

export const authMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: { message: 'Требуется авторизация' },
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, config.jwt.secret) as { id: string };

    const user = await User.findByPk(decoded.id, {
      attributes: ['id', 'email', 'name'],
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        error: { message: 'Пользователь не найден' },
      });
    }

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
    };

    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: { message: 'Токен истёк' },
      });
    }
    logger.error({ error: error.message }, 'Auth middleware error');
    return res.status(401).json({
      success: false,
      error: { message: 'Недействительный токен' },
    });
  }
};

export const optionalAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, config.jwt.secret) as { id: string };
      const user = await User.findByPk(decoded.id, {
        attributes: ['id', 'email', 'name'],
      });
      if (user) {
        req.user = { id: user.id, email: user.email, name: user.name };
      }
    }
  } catch {
    // Ignore auth errors for optional auth
  }
  next();
};