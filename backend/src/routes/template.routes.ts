import { Router } from 'express';
import { templateController } from '../controllers/template.controller';

const router = Router();

router.get('/', templateController.getAll);
router.get('/:id', templateController.getById);

export default router;
