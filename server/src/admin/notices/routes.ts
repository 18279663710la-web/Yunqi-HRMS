import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';

import { adminOf } from '../adminContext';
import { parse } from '../../shared/middleware/validate';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { success } from '../../shared/utils/response';
import { badRequest } from '../../shared/utils/errors';
import { HttpError } from '../../shared/utils/errors';
import {
  createNotice,
  deleteNotice,
  getAdminNotice,
  listAdminNotices,
  noticeAttachmentDir,
  storeNoticeAttachmentFile,
  updateNotice,
} from '../../domains/notices/noticeAdminService';

const router = Router();

const CATEGORY_NAMES: Record<string, string> = {
  company: '公司公告',
  hr: '人事行政',
  it: '技术规范',
  activity: '活动通知',
};

const blockSchema = z.object({
  type: z.enum(['p', 'h', 'list', 'quote']),
  text: z.string().max(2000).optional(),
  items: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
});

const attachmentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  size: z.string().max(20),
  ext: z.string().max(10),
  fileID: z.string().trim().max(200),
});

const noticeInputSchema = z.object({
  title: z.string().trim().min(1).max(255),
  category: z.enum(['company', 'hr', 'it', 'activity']),
  isTop: z.boolean(),
  publishTime: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, '发布时间格式为 YYYY-MM-DD HH:mm'),
  publisherDept: z.string().trim().max(50).optional().default(''),
  summary: z.string().trim().min(1).max(500),
  blocks: z.array(blockSchema).min(1).max(50),
  attachments: z.array(attachmentSchema).max(10).optional().default([]),
});

function normalizeInput(input: z.infer<typeof noticeInputSchema>) {
  return {
    title: input.title,
    category: input.category,
    categoryName: CATEGORY_NAMES[input.category] || input.category,
    isTop: input.isTop,
    publishTime: input.publishTime,
    publisherDept: input.publisherDept || '-',
    summary: input.summary,
    blocks: input.blocks,
    attachments: input.attachments,
  };
}

/* ---------------- 公告附件上传 ---------------- */

const ATTACHMENT_EXTS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md',
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'zip', 'rar', '7z',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = noticeAttachmentDir();
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || '').toLowerCase();
    cb(null, `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || '').replace('.', '').toLowerCase();
    if (!ATTACHMENT_EXTS.has(ext)) {
      cb(new HttpError(400, 400, '不支持的附件类型'));
      return;
    }
    cb(null, true);
  },
});

function uploadSingle(fileField: string) {
  const handler = upload.single(fileField);
  return (req: Request, res: Response) =>
    new Promise<void>((resolve, reject) => {
      handler(req, res, (err: unknown) => {
        if (err) {
          if (err instanceof HttpError) reject(err);
          else if ((err as { code?: string })?.code === 'LIMIT_FILE_SIZE') reject(badRequest('附件大小不能超过 10MB'));
          else reject(badRequest('附件上传失败'));
          return;
        }
        resolve();
      });
    });
}

router.post(
  '/notice-files',
  asyncHandler(async (req, res) => {
    await uploadSingle('file')(req, res);
    const file = (req as unknown as { file?: { originalname: string; filename: string } }).file;
    if (!file) throw badRequest('请选择附件文件');
    success(res, storeNoticeAttachmentFile(file.originalname, file.filename));
  })
);

/* ---------------- 公告 CRUD ---------------- */

router.get(
  '/notices',
  asyncHandler(async (req, res) => {
    success(res, await listAdminNotices({
      keyword: String(req.query.keyword || ''),
      category: String(req.query.category || 'all'),
      page: Number(req.query.page || 1),
      pageSize: Number(req.query.pageSize || 10),
    }));
  })
);

router.get(
  '/notices/:id',
  asyncHandler(async (req, res) => {
    success(res, await getAdminNotice(req.params.id));
  })
);

router.post(
  '/notices',
  asyncHandler(async (req, res) => {
    const input = parse(noticeInputSchema, req.body);
    success(res, await createNotice(normalizeInput(input), adminOf(req).name));
  })
);

router.put(
  '/notices/:id',
  asyncHandler(async (req, res) => {
    const input = parse(noticeInputSchema, req.body);
    success(res, await updateNotice(req.params.id, normalizeInput(input)));
  })
);

router.delete(
  '/notices/:id',
  asyncHandler(async (req, res) => {
    success(res, await deleteNotice(req.params.id));
  })
);

export default router;
