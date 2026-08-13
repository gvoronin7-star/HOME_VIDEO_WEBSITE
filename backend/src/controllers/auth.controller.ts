import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../models';
import { config } from '../config';
import { logger } from '../utils/logger';
import { AuthRequest } from '../middleware/auth.middleware';
import { bindAll } from '../utils/bindAll';
import { setAuthCookie, clearAuthCookie } from '../utils/authCookie';

export class AuthController {
  constructor() {
    // Handlers are passed to Express by reference, so `this` must be bound.
    bindAll(this);
  }

  /**
   * POST /api/auth/register
   * Registration with email + password.
   */
  async register(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password, name } = req.body;

      // Check if user exists
      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
        return res.status(409).json({
          success: false,
          error: { message: 'Пользователь с таким email уже существует' },
        });
      }

      // Hash password
      const salt = await bcrypt.genSalt(12);
      const passwordHash = await bcrypt.hash(password, salt);

      // Create user
      const user = await User.create({
        email,
        passwordHash,
        name: name || '',
      });

      // Generate token
      const token = jwt.sign({ id: user.id }, config.jwt.secret, {
        expiresIn: config.jwt.expiresIn,
      } as jwt.SignOptions);

      // The browser frontend authenticates via this cookie and never touches
      // `data.token` (see S5) — it stays in the response for API clients and
      // the test suite, which sign requests with `Authorization: Bearer`.
      setAuthCookie(req, res, token);

      logger.info({ userId: user.id }, 'User registered');

      res.status(201).json({
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
          },
          token,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/auth/login
   * Login with email + password.
   */
  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password } = req.body;

      const user = await User.findOne({ where: { email } });
      if (!user) {
        return res.status(401).json({
          success: false,
          error: { message: 'Неверный email или пароль' },
        });
      }

      const isValidPassword = await bcrypt.compare(password, user.passwordHash);
      if (!isValidPassword) {
        return res.status(401).json({
          success: false,
          error: { message: 'Неверный email или пароль' },
        });
      }

      const token = jwt.sign({ id: user.id }, config.jwt.secret, {
        expiresIn: config.jwt.expiresIn,
      } as jwt.SignOptions);

      setAuthCookie(req, res, token);

      logger.info({ userId: user.id }, 'User logged in');

      res.json({
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
          },
          token,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/auth/me
   * Get current user profile.
   */
  async me(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = await User.findByPk(req.user!.id, {
        attributes: { exclude: ['passwordHash'] },
      });

      res.json({
        success: true,
        data: { user },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/auth/logout
   * Clears the auth cookie. Necessary because it's `httpOnly` — client-side
   * JavaScript can't read or delete it itself, unlike the old localStorage
   * token.
   */
  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      clearAuthCookie(req, res);
      res.json({ success: true, data: { message: 'Вы вышли из системы' } });
    } catch (error) {
      next(error);
    }
  }
}

export const authController = new AuthController();
