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
  submitApprovalAction,
} from '../../domains/approvals/approvalService';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { notFound } from '../../shared/utils/errors';
import { success } from '../../shared/utils/response';
import { retryWorkflowAi } from '../../domains/approvals/workflowAiWorker';
import { parseApproverType } from '../../domains/approvals/expenseApproverService';

const router = Router();

router.get(
  '/approvals',
  requireAuth,
  asyncHandler(async (req, res) => {
    const raw = String(req.query.tab || 'pending');
    const tab = raw === 'mine' || raw === 'done' ? raw : 'pending';
    const queryNumber = (value: unknown): number | undefined => value === undefined || value === '' ? undefined : Number(value);
    const limit = queryNumber(req.query.limit);
    const page = queryNumber(req.query.page);
    const pageSize = queryNumber(req.query.pageSize);
    success(res, await getApprovalList(tab, req.user, page !== undefined || pageSize !== undefined ? { limit, page, pageSize } : limit));
  })
);

router.get(
  '/approvals/counts',
  requireAuth,
  asyncHandler(async (req, res) => {
    success(res, await getApprovalTabCounts(req.user));
  })
);

router.get(
  '/approvals/pending-count',
  requireAuth,
  asyncHandler(async (req, res) => {
    success(res, await getPendingCount(req.user));
  })
);

router.get(
  '/approvals/:id',
  requireAuth,
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
  fieldAttachments: z.array(z.object({
    fieldKey: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/),
    name: z.string().trim().min(1).max(100),
    fileID: z.string().min(1).max(200),
  })).max(360).optional(),
  urgent: z.boolean().optional(),
  workflowPublicationVersion: z.number().int().min(1).optional(),
  workflowValues: z.record(z.string().max(40), z.string().max(2000)).optional(),
});

const assigneeSchema = z.object({
  type: z.string().min(1).max(20),
  workflowValues: z.record(z.string().max(40), z.string().max(2000)).optional(),
  invoices: z.array(z.object({ totalAmount: z.number().optional() })).max(30).optional(),
});

router.post('/approvals/assignees', requireAuth, asyncHandler(async (req, res) => {
  success(res, await previewApprovalAssignees(parse(assigneeSchema, req.body)));
}));

router.post(
  '/approvals',
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = parse(createSchema, req.body);
    success(res, await createApproval(payload, req.user));
  })
);

router.post('/approvals/:id/retry-ai', requireAuth, asyncHandler(async (req, res) => {
  success(res, await retryWorkflowAi(req.params.id, req.user));
}));

const actionSchema = z.object({
  action: z.enum(['approve', 'reject']),
  comment: z.string().max(200).optional().default(''),
});

router.post(
  '/approvals/:id/action',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parse(actionSchema, req.body);
    const result = await submitApprovalAction(req.params.id, body.action, body.comment || '', req.user);
    success(res, result);
  })
);

const cancelSchema = z.object({}).passthrough();

router.post(
  '/approvals/:id/cancel',
  requireAuth,
  asyncHandler(async (req, res) => {
    parse(cancelSchema, req.body || {});
    const result = await cancelApproval(req.params.id, req.user);
    success(res, result);
  })
);

export default router;
