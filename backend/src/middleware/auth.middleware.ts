import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { User } from '../models';
import { logger } from '../utils/logger';
import { AUTH_COOKIE_NAME } from '../utils/authCookie';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
  };
}

/**
 * The browser frontend authenticates via the `httpOnly` cookie (S5) and never
 * sends `Authorization` — API clients and the test suite still use the
 * header, so both are accepted. Header takes priority only because it's the
 * more explicit signal when a caller sends both.
 */
function extractToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.split(' ')[1];
  }
  return req.cookies?.[AUTH_COOKIE_NAME];
}

export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        error: { message: 'Требуется авторизация' },
      });
    }

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

export const optionalAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const token = extractToken(req);
    if (token) {
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
