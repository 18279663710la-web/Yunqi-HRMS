import { Router } from 'express';
import { z } from 'zod';
import { parse } from '../../shared/middleware/validate';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { success } from '../../shared/utils/response';
import { recordAdminLog } from '../../domains/audit/adminLogService';
import { addDisbursementField, getDisbursement, setDisbursementValue } from './hrDisbursementService';

const router = Router();
const id = z.coerce.number().int().positive().safe();
const fieldSchema = z.object({ name: z.string().trim().min(1).max(60), category: z.enum(['income', 'deduction', 'info']), required: z.boolean(), displaySetting: z.enum(['none', 'display', 'output']) }).strict();
const valueSchema = z.object({ value: z.number().finite().min(0).max(9999999999.99).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-5, '最多两位小数'), revision: z.number().int().nonnegative().safe() }).strict();

router.get('/payroll-batches/:id/disbursement', asyncHandler(async (req, res) => success(res, await getDisbursement(parse(id, req.params.id)))));
router.post('/payroll-batches/:id/disbursement/fields', asyncHandler(async (req, res) => {
  const batchId = parse(id, req.params.id);
  const result = await addDisbursementField(batchId, parse(fieldSchema, req.body));
  await recordAdminLog(req.admin!, '创建工资发放补充项', 'hr_payroll_batches', String(batchId), { fieldId: result.id });
  success(res, result);
}));
router.put('/payroll-batches/:id/disbursement/items/:itemId/fields/:fieldId', asyncHandler(async (req, res) => {
  const batchId = parse(id, req.params.id); const itemId = parse(id, req.params.itemId); const fieldId = parse(id, req.params.fieldId);
  const input = parse(valueSchema, req.body);
  const result = await setDisbursementValue(batchId, itemId, fieldId, input.value, input.revision, req.admin!.id);
  await recordAdminLog(req.admin!, '修改工资发放补充项', 'hr_payroll_batches', String(batchId), { itemId, fieldId });
  success(res, result);
}));
export default router;
