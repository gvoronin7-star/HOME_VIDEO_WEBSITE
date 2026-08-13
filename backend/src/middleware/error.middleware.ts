import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export class AppError extends Error {
  public statusCode: number;
  public isOperational: boolean;

  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  // Express only recognises this as error-handling middleware (as opposed to
  // a regular one) if it takes exactly 4 parameters — `next` has to stay even
  // though it's never called.
  _next: NextFunction,
) => {
  const statusCode = err.statusCode || 500;
  const message = err.isOperational ? err.message : 'Внутренняя ошибка сервера';

  if (statusCode === 500) {
    logger.error({ error: err.message, stack: err.stack, path: req.path }, 'Unhandled error');
  }

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      ...(statusCode === 422 && { details: (err as any).details }),
    },
  });
};

export const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: {
      message: `Маршрут ${req.method} ${req.path} не найден`,
    },
  });
};
