import { Router } from 'express';

import { resetDemoContent } from '../../shared/db/seed';
import { requireAuth } from '../auth/authMiddleware';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { success } from '../../shared/utils/response';

const router = Router();
router.use(requireAuth);

/**
 * 恢复演示数据：重置打卡及公告已读记录，保留审批和发票。
 * 仅用于本项目演示，正式环境应移除该接口。
 */
router.post(
  '/demo/reset',
  asyncHandler(async (_req, res) => {
    await resetDemoContent();
    success(res, { ok: true, message: '演示数据已重置' });
  })
);

export default router;
