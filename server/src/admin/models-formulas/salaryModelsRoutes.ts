import { Router } from 'express';
import { recordAdminLog } from '../../domains/audit/adminLogService';
import { salaryModelInputSchema } from '../../domains/payroll/salaryModelSchema';
import { readSalaryModel } from '../../domains/payroll/salaryModelService';
import { SALARY_MODEL_KEY, saveSalaryModel } from '../../domains/payroll/salaryModelUpdateService';
import { parse } from '../../shared/middleware/validate';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { success } from '../../shared/utils/response';

const router = Router();
router.get('/salary-model', asyncHandler(async (_req, res) => {
  success(res, await readSalaryModel());
}));
router.put('/salary-model', asyncHandler(async (req, res) => {
  const saved = await saveSalaryModel(parse(salaryModelInputSchema, req.body));
  await recordAdminLog(req.admin!, '保存薪资构成模型', 'hr_settings', SALARY_MODEL_KEY, { fixedCount: saved.fixedFields.length, extendedCount: saved.extendedFields.length });
  success(res, saved);
}));
export default router;
