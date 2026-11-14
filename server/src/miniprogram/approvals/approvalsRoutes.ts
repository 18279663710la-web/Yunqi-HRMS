import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../auth/authMiddleware';
import { parse } from '../../shared/middleware/validate';
import {
  cancelApproval,
  createApproval,
  getApprovalDetail,
  previewApprovalAssignees,
  getApprovalList,
  getApprovalTabCounts,
  getPendingCount,
  getLeaveApprover,
  submitApprovalAction,
  previewExpenseApproval,
} from '../../domains/approvals/approvalService';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { notFound } from '../../shared/utils/errors';
import { success } from '../../shared/utils/response';
import { retryWorkflowAi } from '../../domains/approvals/workflowAiWorker';
import { getExpenseApprover, getApprovalApprover, parseApproverType } from '../../domains/approvals/expenseApproverService';

const router = Router();
router.use(requireAuth);

router.get(
  '/approvals',
  asyncHandler(async (req, res) => {
    const raw = String(req.query.tab || 'pending');
    const tab = raw === 'mine' || raw === 'done' ? raw : 'pending';
    success(res, await getApprovalList(tab, req.user));
  })
);

router.get(
  '/approvals/counts',
  asyncHandler(async (req, res) => {
    success(res, await getApprovalTabCounts(req.user));
  })
);

router.get(
  '/approvals/pending-count',
  asyncHandler(async (req, res) => {
    success(res, await getPendingCount(req.user));
  })
);

router.get(
  '/approvals/leave-approver',
  asyncHandler(async (req, res) => {
    success(res, await getLeaveApprover(req.user));
  })
);

router.get('/approvals/expense-approver', asyncHandler(async (_req, res) => {
  success(res, await getExpenseApprover());
}));

router.get('/approvals/approvers/:type', asyncHandler(async (req, res) => {
  success(res, await getApprovalApprover(parseApproverType(req.params.type)));
}));

router.get(
  '/approvals/:id',
  asyncHandler(async (req, res) => {
    const detail = await getApprovalDetail(req.params.id, req.user);
    if (!detail) throw notFound('审批单不存在或已被删除');
    success(res, detail);
  })
);

const createSchema = z.object({
  type: z.string().min(1).max(20),
  title: z.string().max(200).optional(),
  summary: z.string().max(500).optional(),
  form: z
    .array(z.object({ label: z.string().max(100), value: z.string().max(2000) }))
    .max(60)
    .optional(),
  invoices: z.array(z.record(z.string(), z.any())).max(30).optional(),
  attachments: z.array(z.object({ name: z.string().trim().min(1).max(100), fileID: z.string().min(1).max(200) })).max(9).optional(),
  urgent: z.boolean().optional(),
  workflowPublicationVersion: z.number().int().min(1).optional(),
  workflowValues: z.record(z.string().max(40), z.string().max(2000)).optional(),
});

const assigneeSchema = z.object({
  type: z.string().min(1).max(20),
  workflowValues: z.record(z.string().max(40), z.string().max(2000)).optional(),
  invoices: z.array(z.object({ totalAmount: z.number().optional() })).max(30).optional(),
});

router.post('/approvals/assignees', asyncHandler(async (req, res) => {
  success(res, await previewApprovalAssignees(parse(assigneeSchema, req.body)));
}));

router.post('/approvals/expense-precheck', asyncHandler(async (req, res) => {
  const payload = parse(createSchema, req.body);
  success(res, await previewExpenseApproval(payload, req.user));
}));

router.post('/approvals/expense-precheck/stream', asyncHandler(async (req, res) => {
  const payload = parse(createSchema, req.body);
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  const send = (event: unknown): void => {
    if (res.destroyed || res.writableEnded) return;
    if (!res.headersSent) {
      res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
      res.flushHeaders();
    }
    const json = JSON.stringify(event).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
    res.write(`data: ${json}\n\n`);
  };
  const result = await previewExpenseApproval(payload, req.user, { onProgress: (text) => send({ type: 'progress', text }), signal: controller.signal });
  send({ type: 'result', ...result });
  if (!res.destroyed) res.end();
}));

router.post(
  '/approvals',
  asyncHandler(async (req, res) => {
    const payload = parse(createSchema, req.body);
    success(res, await createApproval(payload, req.user));
  })
);

router.post('/approvals/:id/retry-ai', asyncHandler(async (req, res) => {
  success(res, await retryWorkflowAi(req.params.id, req.user));
}));

const actionSchema = z.object({
  action: z.enum(['approve', 'reject']),
  comment: z.string().max(200).optional().default(''),
});

router.post(
  '/approvals/:id/action',
  asyncHandler(async (req, res) => {
    const body = parse(actionSchema, req.body);
    const result = await submitApprovalAction(req.params.id, body.action, body.comment || '', req.user);
    success(res, result);
  })
);

const cancelSchema = z.object({}).passthrough();

router.post(
  '/approvals/:id/cancel',
  asyncHandler(async (req, res) => {
    parse(cancelSchema, req.body || {});
    const result = await cancelApproval(req.params.id, req.user);
    success(res, result);
  })
);

export default router;
