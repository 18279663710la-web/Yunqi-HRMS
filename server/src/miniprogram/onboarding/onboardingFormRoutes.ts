import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { getPendingOnboarding, submitOnboarding } from '../../domains/onboarding/employeeOnboardingService';
import { requireAuth } from '../auth/authMiddleware';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { success } from '../../shared/utils/response';
import { parse } from '../../shared/middleware/validate';
import { badRequest } from '../../shared/utils/errors';
import { saveOnboardingFile } from '../../domains/onboarding/onboardingFiles';

const employee = Router();
employee.use(requireAuth);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 }, defParamCharset: 'utf8' }).single('file');
const uploadFile: RequestHandler = (req, res, next) => upload(req, res, error => {
  if (error instanceof multer.MulterError) { next(badRequest(error.code === 'LIMIT_FILE_SIZE' ? '附件不能超过 10MB' : '附件上传失败')); return; }
  next(error);
});
employee.post('/attachments', uploadFile, asyncHandler(async (req, res) => {
  const body = parse(z.object({ field: z.string().trim().min(1).max(30), child: z.string().trim().min(1).max(30).optional(), filename: z.string().min(1).max(255).optional() }), req.body);
  success(res, await saveOnboardingFile(req.user.id, body.field, body.child, req.file, body.filename));
}));
employee.get('/pending', asyncHandler(async (req, res) => {
  success(res, await getPendingOnboarding(req.user.id));
}));
employee.post('/submit', asyncHandler(async (req, res) => {
  await submitOnboarding(req.user.id, req.body);
  success(res, {});
}));

export default employee;
