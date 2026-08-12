import { Router } from 'express';
import { healthCheck } from '../controllers/health.controller';

const router = Router();

// Public health check endpoint (no auth required)
router.get('/', healthCheck);

export default router;
