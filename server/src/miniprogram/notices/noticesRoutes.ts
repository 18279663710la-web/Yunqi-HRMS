import { Router } from 'express';

import { requireAuth } from '../auth/authMiddleware';
import {
  getNoticeCategories,
  getNoticeDetail,
  getNotices,
  getUnreadNoticeCount,
} from '../../domains/notices/noticeService';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { notFound } from '../../shared/utils/errors';
import { success } from '../../shared/utils/response';

const router = Router();

router.get(
  '/notices/categories',
  requireAuth,
  asyncHandler(async (_req, res) => {
    success(res, getNoticeCategories());
  })
);

router.get(
  '/notices/unread-count',
  requireAuth,
  asyncHandler(async (req, res) => {
    success(res, await getUnreadNoticeCount(req.user.id));
  })
);

router.get(
  '/notices',
  requireAuth,
  asyncHandler(async (req, res) => {
    const category = String(req.query.category || 'all');
    const keyword = String(req.query.keyword || '');
    success(res, await getNotices(req.user.id, { category, keyword }));
  })
);

router.get(
  '/notices/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const detail = await getNoticeDetail(req.params.id, req.user.id);
    if (!detail) throw notFound('公告不存在或已下线');
    success(res, detail);
  })
);

export default router;
