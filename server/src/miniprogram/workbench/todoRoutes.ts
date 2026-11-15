import { Router } from 'express';

import { requireAuth } from '../auth/authMiddleware';
import { getTodoStats } from './statsService';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { success } from '../../shared/utils/response';

const router = Router();

router.get(
  '/todo-stats',
  requireAuth,
  asyncHandler(async (req, res) => {
    success(res, await getTodoStats(req.user));
  })
);

export default router;
