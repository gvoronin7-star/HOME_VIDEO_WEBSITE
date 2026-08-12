import { Router } from 'express';
import { voiceController } from '../controllers/voice.controller';

const router = Router();

// Public: the voice picker is shown before a story exists.
router.get('/', voiceController.getAll);

export default router;
