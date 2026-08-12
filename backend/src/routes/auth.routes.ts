import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { z } from 'zod';
import { validate } from '../middleware/validate.middleware';
import { authLimiter, registerLimiter } from '../middleware/rateLimit.middleware';

const router = Router();

const registerSchema = z.object({
  body: z.object({
    email: z.string().email('Некорректный email'),
    password: z.string().min(6, 'Пароль должен быть минимум 6 символов'),
    name: z.string().optional(),
  }),
});

const loginSchema = z.object({
  body: z.object({
    email: z.string().email('Некорректный email'),
    password: z.string().min(1, 'Введите пароль'),
  }),
});

// Credential endpoints are rate limited: this is where repeating a request
// thousands of times actually gains an attacker something.
router.post('/register', registerLimiter, validate(registerSchema), authController.register);
router.post('/login', authLimiter, validate(loginSchema), authController.login);
router.get('/me', authMiddleware, authController.me);

export default router;