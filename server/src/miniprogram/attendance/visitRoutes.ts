import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';

import { asyncHandler } from '../../shared/utils/asyncHandler';
import { badRequest } from '../../shared/utils/errors';
import { parse } from '../../shared/middleware/validate';
import { success } from '../../shared/utils/response';
import {
  createVisit,
  getVisitPhoto,
  listMyVisits,
  saveVisitPhoto,
} from '../../domains/attendance/visitService';
import { reverseGeocode } from '../../domains/attendance/geocodeService';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 }, defParamCharset: 'utf8' }).single('file');
const uploadPhoto: RequestHandler = (req, res, next) => upload(req, res, (error) => {
  if (error instanceof multer.MulterError) {
    next(badRequest(error.code === 'LIMIT_FILE_SIZE' ? '单张现场照片不能超过 5MB' : '现场照片上传失败'));
    return;
  }
  next(error);
});

const createSchema = z.object({
  customerName: z.string().trim().min(1).max(100),
  purpose: z.string().trim().min(1).max(200),
  addressName: z.string().trim().max(100).optional().default(''),
  address: z.string().trim().min(1).max(255),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().min(0).max(100000).optional(),
  remark: z.string().trim().max(500).optional().default(''),
  photoIds: z.array(z.string().trim().min(1).max(36)).min(1).max(3),
});

router.get('/location', asyncHandler(async (req, res) => {
  const query = parse(z.object({
    latitude: z.coerce.number().finite().min(-90).max(90),
    longitude: z.coerce.number().finite().min(-180).max(180),
  }), req.query);
  success(res, await reverseGeocode(query.latitude, query.longitude));
}));

router.post('/photos', uploadPhoto, asyncHandler(async (req, res) => {
  success(res, await saveVisitPhoto(req.user.id, req.file));
}));

router.get('/photos/:id', asyncHandler(async (req, res) => {
  const id = parse(z.string().uuid(), req.params.id);
  const photo = await getVisitPhoto(id, req.user.id);
  res.set({
    'Content-Type': photo.mimeType,
    'Content-Disposition': `inline; filename="visit-photo"; filename*=UTF-8''${encodeURIComponent(photo.fileName)}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(photo.data);
}));

router.post('/', asyncHandler(async (req, res) => {
  const body = parse(createSchema, req.body);
  success(res, await createVisit(req.user.id, body));
}));

router.get('/', asyncHandler(async (req, res) => {
  const month = typeof req.query.month === 'string' ? req.query.month : undefined;
  const limit = Number(req.query.limit || 20);
  success(res, await listMyVisits(req.user.id, month, Number.isFinite(limit) ? limit : 20));
}));

export default router;
