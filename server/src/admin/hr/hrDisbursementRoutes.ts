import { Router } from 'express';
import { z } from 'zod';
import { parse } from '../../shared/middleware/validate';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { success } from '../../shared/utils/response';
import { recordAdminLog } from '../../domains/audit/adminLogService';
import { addDisbursementField, getDisbursement, issueDisbursement, setDisbursementValue } from './hrDisbursementService';
import { queryOne, queryRows } from '../../shared/db/pool';
import { notFound } from '../../shared/utils/errors';

const router = Router();
const id = z.coerce.number().int().positive().safe();
const fieldSchema = z.object({ name: z.string().trim().min(1).max(60), category: z.enum(['income', 'deduction', 'info']), required: z.boolean(), displaySetting: z.enum(['none', 'display', 'output']) }).strict();
const valueSchema = z.object({ value: z.number().finite().min(0).max(9999999999.99).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-5, '最多两位小数'), revision: z.number().int().nonnegative().safe() }).strict();
const issueSchema = z.object({ revision: z.string().min(1).max(128) }).strict();

router.get('/payroll-batches/:id/disbursement', asyncHandler(async (req, res) => success(res, await getDisbursement(parse(id, req.params.id)))));
router.post('/payroll-batches/:id/disbursement/issue', asyncHandler(async (req, res) => {
  const batchId = parse(id, req.params.id); const input = parse(issueSchema, req.body);
  const result = await issueDisbursement(batchId, input.revision, req.admin!.id);
  await recordAdminLog(req.admin!, '登记工资批次发放', 'hr_payroll_batches', String(batchId), { recordId: result.id });
  success(res, result);
}));
router.get('/payroll-disbursement-records', asyncHandler(async (_req, res) => {
  success(res, await queryRows('SELECT id, batch_id AS batchId, payroll_month AS month, gross_total AS grossTotal, net_total AS netTotal, note, created_at AS createdAt FROM hr_payroll_disbursement_records ORDER BY id DESC LIMIT 500'));
}));
router.get('/payroll-disbursement-records/:id', asyncHandler(async (req, res) => {
  const record = await queryOne<{ snapshot: unknown }>('SELECT snapshot_json AS snapshot FROM hr_payroll_disbursement_records WHERE id = ?', [parse(id, req.params.id)]);
  if (!record) throw notFound('工资发放记录不存在');
  success(res, typeof record.snapshot === 'string' ? JSON.parse(record.snapshot) : record.snapshot);
}));
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
