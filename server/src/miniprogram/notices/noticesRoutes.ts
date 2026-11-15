import { Router } from 'express';

import { requireAuth } from '../auth/authMiddleware';
import {
  getNoticeCategories,
  getNoticeDetail,
  getNotices,
  getNoticesPage,
  getUnreadNoticeCount,
} from '../../domains/notices/noticeService';
import { resolveNoticeAttachment } from '../../domains/notices/noticeAdminService';
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

// 分页列表须在 /notices/:id 之前注册，避免 page 被当作 id
router.get(
  '/notices/page',
  requireAuth,
  asyncHandler(async (req, res) => {
    success(res, await getNoticesPage(req.user.id, {
      category: String(req.query.category || 'all'),
      keyword: String(req.query.keyword || ''),
      page: Number(req.query.page || 1),
      pageSize: Number(req.query.pageSize || 10),
    }));
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

/** 公告附件下载（员工鉴权；文件名经服务端登记校验，防穿越/越权） */
router.get(
  '/notice-files/:name',
  requireAuth,
  asyncHandler(async (req, res) => {
    const resolved = await resolveNoticeAttachment(req.params.name);
    if (!resolved) throw notFound('附件不存在或已下线');
    res.download(resolved.filePath, resolved.downloadName);
  })
);

export default router;
