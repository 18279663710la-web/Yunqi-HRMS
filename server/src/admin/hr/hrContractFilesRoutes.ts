import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { parse } from '../../shared/middleware/validate';
import { recordAdminLog } from '../../domains/audit/adminLogService';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { badRequest } from '../../shared/utils/errors';
import { success } from '../../shared/utils/response';
import { getContractFile, listContractFiles, saveContractFile } from './contractFilesService';

const router = Router();
const maxFileSize = 10 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxFileSize, files: 1 }, defParamCharset: 'utf8' }).single('file');
const uploadFile: RequestHandler = (req, res, next) => upload(req, res, error => {
  if (error instanceof multer.MulterError) { next(badRequest(error.code === 'LIMIT_FILE_SIZE' ? '合同文件不能超过 10MB' : '合同文件上传失败')); return; }
  next(error);
});
const employeeIdSchema = z.string().min(1).max(10);
const fileIdSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
router.get('/employees/:id/contract-files', asyncHandler(async (req, res) => {
  const id = parse(employeeIdSchema, req.params.id);
  const files = await listContractFiles(id);
  success(res, files);
}));
router.post('/employees/:id/contract-files', uploadFile, asyncHandler(async (req, res) => {
  const id = parse(employeeIdSchema, req.params.id);
  const result = await saveContractFile(id, req.file, req.admin!.id);
  await recordAdminLog(req.admin!, '导入劳动合同文件', 'hr_contract_files', String(result.insertId), { employeeId: id });
  success(res, { id: result.insertId });
}));
router.get('/employees/:id/contract-files/:fileId', asyncHandler(async (req, res) => {
  const employeeId = parse(employeeIdSchema, req.params.id); const fileId = parse(fileIdSchema, req.params.fileId);
  const file = await getContractFile(employeeId, fileId);
  const encoded = encodeURIComponent(file.file_name).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  res.set({ 'Content-Type': file.mime_type, 'Content-Disposition': `attachment; filename="contract-file"; filename*=UTF-8''${encoded}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  res.send(file.file_data);
}));
export default router;
