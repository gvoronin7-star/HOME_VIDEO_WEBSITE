import express, { Express } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'path';
import { config } from './config';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { logger } from './utils/logger';
import authRoutes from './routes/auth.routes';
import templateRoutes from './routes/template.routes';
import storyRoutes from './routes/story.routes';
import shareRoutes from './routes/share.routes';
import healthRoutes from './routes/health.routes';
import voiceRoutes from './routes/voice.routes';
import { globalLimiter, publicLimiter } from './middleware/rateLimit.middleware';

export function createApp(): Express {
  const app = express();

  /**
   * Trust exactly one proxy hop.
   *
   * In Docker nginx forwards every request, so without this `req.ip` is the nginx
   * container address for all clients and the rate limiters below would treat the
   * entire internet as a single visitor. Trusting only the first hop means a
   * client-supplied `X-Forwarded-For` cannot be used to fake more hops.
   *
   * Note: this assumes the API is reached through the proxy. If port 4000 is also
   * published directly, a client could set the header itself — keep it internal.
   */
  app.set('trust proxy', 1);

  // === Security headers ===
  app.use(
    helmet({
      // This process serves JSON and static media, never HTML documents, so the
      // tightest possible policy is also the correct one. It matters for the
      // uploads below: a file served with `default-src 'none'` cannot execute
      // anything even if something unexpected ends up on disk.
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'none'"],
          'frame-ancestors': ["'none'"],
          'base-uri': ["'none'"],
          'form-action': ["'none'"],
        },
      },
      // Deliberately cross-origin, not the same-origin default: videos, photos and
      // QR codes are embedded by the frontend, which is a different origin whenever
      // it is not being proxied. The default would silently break media playback.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      // Would block the same embedding as above.
      crossOriginEmbedderPolicy: false,
      // Only meaningful once TLS terminates in front of this service; harmless
      // otherwise, and correct as soon as HTTPS is configured.
      hsts: { maxAge: 31_536_000, includeSubDomains: true },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  // === Middleware ===
  app.use(
    cors({
      origin: config.server.corsOrigin,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));
  // Unsigned: the JWT it carries is already signed and verified independently
  // in auth.middleware — a signing secret here would protect nothing extra.
  app.use(cookieParser());

  // Request logging
  app.use((req, res, next) => {
    logger.info({ method: req.method, path: req.path }, 'Request');
    next();
  });

  // === Static files (uploads) ===
  const uploadsPath = path.resolve(config.storage.path);

  app.use(
    '/uploads',
    (req, res, next) => {
      // PDFs are downloaded, not viewed in place: forcing an attachment keeps the
      // browser from rendering a served file as a document. Media stays inline
      // because the app plays and displays it directly.
      res.setHeader(
        'Content-Disposition',
        req.path.toLowerCase().endsWith('.pdf') ? 'attachment' : 'inline',
      );
      next();
    },
    express.static(uploadsPath, {
      // No directory listings, no serving of dotfiles that end up in the volume.
      index: false,
      dotfiles: 'deny',
      // Uploaded assets are content-addressed by uuid, so they never change.
      maxAge: '7d',
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
      },
    }),
  );

  // === API Routes ===
  // Health is intentionally unlimited: orchestrators poll it on a short interval
  // and must never be throttled into reporting a false outage.
  app.use('/api/health', healthRoutes);

  // Backstop first; the tighter per-area limits are applied inside the routers.
  app.use('/api', globalLimiter);

  app.use('/api/auth', authRoutes);
  app.use('/api/templates', templateRoutes);
  app.use('/api/voices', voiceRoutes);
  app.use('/api/stories', storyRoutes);
  app.use('/api/share', publicLimiter, shareRoutes);

  // === Error handling ===
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
