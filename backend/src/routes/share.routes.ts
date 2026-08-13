import { Router } from 'express';
import { shareController } from '../controllers/share.controller';

const router = Router();

router.get('/:token', shareController.getPublicStory);

export default router;
