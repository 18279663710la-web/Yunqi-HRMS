import crypto from 'node:crypto';
import path from 'node:path';

import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';

import { config } from '../../config';
import { requireAuth } from '../auth/authMiddleware';
import { parse } from '../../shared/middleware/validate';
import {
  checkDuplicate,
  getInvoiceMeta,
  recordInvoiceUpload,
  recognizeInvoice,
  verifyInvoice,
} from '../../domains/invoices/invoiceService';
import type { Invoice } from '../../shared/types/models';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { HttpError, badRequest } from '../../shared/utils/errors';
import { success } from '../../shared/utils/response';

const router = Router();
router.use(requireAuth);

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/gif': '.gif',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  filename: (_req, file, cb) => {
    const ext = EXT_BY_MIME[file.mimetype] || path.extname(file.originalname || '').toLowerCase() || '.jpg';
    cb(null, `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new HttpError(400, 400, '只支持上传图片文件'));
  },
});

router.get(
  '/invoices/meta',
  asyncHandler(async (_req, res) => {
    success(res, getInvoiceMeta());
  })
);

const invoiceSchema = z.object({
  invoice: z.record(z.string(), z.any()),
});

router.post(
  '/invoices/duplicate',
  asyncHandler(async (req, res) => {
    const body = parse(invoiceSchema, req.body);
    const result = await checkDuplicate(body.invoice as unknown as Invoice);
    success(res, result);
  })
);

router.post(
  '/invoices/verify',
  asyncHandler(async (req, res) => {
    const body = parse(invoiceSchema, req.body);
    const result = await verifyInvoice(body.invoice as unknown as Invoice);
    success(res, result);
  })
);

router.post(
  '/invoices/image',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('缺少发票图片');
    await recordInvoiceUpload(`/uploads/${req.file.filename}`, req.user.id);
    success(res, { fileUrl: `/uploads/${req.file.filename}` });
  })
);

router.post(
  '/ocr/invoice',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('缺少发票图片');
    const rawIndex = Number(req.body.index ?? req.query.index ?? 0);
    const index = Number.isFinite(rawIndex) ? rawIndex : 0;
    const fileUrl = `/uploads/${req.file.filename}`;
    success(res, recognizeInvoice(index, fileUrl));
  })
);

export default router;
