import { Router } from 'express';
import { z } from 'zod';

import { getApprovalApproverSettings,getCustomWorkflowApproverCandidates,getExpenseApproverSettings,parseApproverType,setApprovalApprover,setExpenseApprover } from '../../domains/approvals/expenseApproverService';
import { getExpenseRules,saveExpenseRules } from '../../domains/approvals/expenseRulesService';
import { customWorkflowSchema, readCustomWorkflow, saveCustomWorkflow } from '../../domains/approvals/customWorkflowService';
import { runSavedWorkflowTests } from '../../domains/approvals/customWorkflowTestRunner';
import { publishCustomWorkflow, readPublishedWorkflow } from '../../domains/approvals/customWorkflowPublication';
import { readFixedWorkflowTestFields } from '../../domains/approvals/customWorkflowTestFields';
import { readWorkflowTestCases, saveWorkflowTestCases, workflowTestCasesSchema } from '../../domains/approvals/customWorkflowTestCases';
import { recordAdminLog } from '../../domains/audit/adminLogService';
import { requireSuperAdmin } from '../admin-accounts/authMiddleware';
import { parse } from '../../shared/middleware/validate';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { success } from '../../shared/utils/response';
import { adminOf } from '../adminContext';

const router = Router();

router.get('/approval-workflows/:type/approver-candidates', requireSuperAdmin, asyncHandler(async (req, res) => {
  parseApproverType(req.params.type);
  success(res, await getCustomWorkflowApproverCandidates());
}));

router.get('/approval-workflows/:type/test-fields', requireSuperAdmin, asyncHandler(async (req, res) => {
  success(res, { fields: await readFixedWorkflowTestFields(parseApproverType(req.params.type)) });
}));

router.get('/approval-workflows/:type/test-cases', requireSuperAdmin, asyncHandler(async (req, res) => {
  success(res, await readWorkflowTestCases(parseApproverType(req.params.type)));
}));

router.put('/approval-workflows/:type/test-cases', requireSuperAdmin, asyncHandler(async (req, res) => {
  const type = parseApproverType(req.params.type);
  const cases = await saveWorkflowTestCases(type, parse(workflowTestCasesSchema, req.body), adminOf(req).id);
  await recordAdminLog(adminOf(req), '保存审批流程测试用例', 'custom_approval_test_cases', type, { count: cases.cases.length });
  success(res, cases);
}));

router.post('/approval-workflows/:type/test', requireSuperAdmin, asyncHandler(async (req, res) => {
  success(res, await runSavedWorkflowTests(parseApproverType(req.params.type), adminOf(req).id));
}));

router.get('/approval-workflows/:type/publication', requireSuperAdmin, asyncHandler(async (req, res) => {
  const published = await readPublishedWorkflow(parseApproverType(req.params.type));
  success(res, published ? { publicationVersion: published.publicationVersion, workflowVersion: published.workflowVersion, caseVersion: published.caseVersion } : null);
}));

router.post('/approval-workflows/:type/publish', requireSuperAdmin, asyncHandler(async (req, res) => {
  const type = parseApproverType(req.params.type);
  const input = parse(z.object({ workflowVersion: z.number().int().min(0), caseVersion: z.number().int().min(0) }).strict(), req.body);
  const published = await publishCustomWorkflow(type, input.workflowVersion, input.caseVersion, adminOf(req).id);
  await recordAdminLog(adminOf(req), '发布审批流程', 'custom_approval_publications', type, { publicationVersion: published.publicationVersion, workflowVersion: published.workflowVersion, caseVersion: published.caseVersion });
  success(res, { publicationVersion: published.publicationVersion, workflowVersion: published.workflowVersion, caseVersion: published.caseVersion });
}));

router.get('/approval-workflows/:type', requireSuperAdmin, asyncHandler(async (req, res) => {
  success(res, await readCustomWorkflow(parseApproverType(req.params.type)));
}));

router.put('/approval-workflows/:type', requireSuperAdmin, asyncHandler(async (req, res) => {
  const type = parseApproverType(req.params.type);
  const input = parse(customWorkflowSchema, req.body);
  const saved = await saveCustomWorkflow(type, input, adminOf(req).id);
  await recordAdminLog(adminOf(req), '保存自定义审批流程设计稿', 'custom_approval_workflows', type, { nodeCount: saved.nodes.length, edgeCount: saved.edges.length });
  success(res, saved);
}));

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
