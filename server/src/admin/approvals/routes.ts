import { Router } from 'express';
import { z } from 'zod';

import { getApprovalApproverSettings,getExpenseApproverSettings,parseApproverType,setApprovalApprover,setExpenseApprover } from '../../domains/approvals/expenseApproverService';
import { getExpenseRules,saveExpenseRules } from '../../domains/approvals/expenseRulesService';
import { requireSuperAdmin } from '../admin-accounts/authMiddleware';
import { parse } from '../../shared/middleware/validate';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { success } from '../../shared/utils/response';
import { adminOf } from '../adminContext';

const router = Router();

router.get('/expense-approver', requireSuperAdmin, asyncHandler(async (_req, res) => {
  success(res, await getExpenseApproverSettings());
}));

router.put('/expense-approver', requireSuperAdmin, asyncHandler(async (req, res) => {
  const body = parse(z.object({ employeeId: z.string().trim().min(1).max(10) }), req.body);
  success(res, await setExpenseApprover(body.employeeId, adminOf(req)));
}));

router.get('/approval-approvers/:type', requireSuperAdmin, asyncHandler(async (req, res) => {
  success(res, await getApprovalApproverSettings(parseApproverType(req.params.type)));
}));

router.put('/approval-approvers/:type', requireSuperAdmin, asyncHandler(async (req, res) => {
  const body = parse(z.object({ employeeId: z.string().trim().min(1).max(10) }), req.body);
  success(res, await setApprovalApprover(parseApproverType(req.params.type), body.employeeId, adminOf(req)));
}));

router.get('/expense-rules', requireSuperAdmin, asyncHandler(async (_req, res) => {
  success(res, await getExpenseRules());
}));

router.put('/expense-rules', requireSuperAdmin, asyncHandler(async (req, res) => {
  const body = parse(z.object({ content: z.string().max(10000) }), req.body);
  success(res, await saveExpenseRules(body.content, adminOf(req)));
}));


export default router;
