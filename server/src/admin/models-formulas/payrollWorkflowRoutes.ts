import { Router } from 'express';
import { parse } from '../../shared/middleware/validate';
import { recordAdminLog } from '../../domains/audit/adminLogService';
import {
  PAYROLL_WORKFLOW_KEY,
  payrollWorkflowInputSchema,
  readPayrollWorkflow,
  savePayrollWorkflow,
} from '../../domains/payroll/payrollWorkflowService';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { success } from '../../shared/utils/response';

const router = Router();

router.get('/payroll-workflow', asyncHandler(async (_req, res) => {
  success(res, await readPayrollWorkflow());
}));

router.put('/payroll-workflow', asyncHandler(async (req, res) => {
  const input = parse(payrollWorkflowInputSchema, req.body);
  const saved = await savePayrollWorkflow(input);
  await recordAdminLog(req.admin!, '保存薪资发放流程', 'hr_settings', PAYROLL_WORKFLOW_KEY, { nodeCount: saved.nodes.length, edgeCount: saved.edges.length });
  success(res, saved);
}));

export default router;
