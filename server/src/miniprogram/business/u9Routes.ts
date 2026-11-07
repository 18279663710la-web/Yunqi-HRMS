import { Router } from 'express';
import { z } from 'zod';
import type { U9DocumentKind, U9Gateway } from '../../domains/u9/types';
import { requireAuth } from '../auth/authMiddleware';
import { queryOne } from '../../shared/db/pool';
import { parse } from '../../shared/middleware/validate';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { badRequest, forbidden, notFound } from '../../shared/utils/errors';
import { success } from '../../shared/utils/response';
import { documentPdf, summaryPdf } from '../../domains/u9/pdf';

export function createU9BusinessRouter(u9: U9Gateway): Router {
  const router = Router();
  router.use(requireAuth);
  const kindSchema = z.enum(['receivables', 'receipts']);
  async function operatorFor(user: Express.Request['user']): Promise<string> {
    if (user.isChairperson || user.position !== '业务员') throw forbidden('仅业务员可访问');
    const binding = await queryOne<{ operator_id: string }>('SELECT operator_id FROM u9_employee_bindings WHERE employee_id=?', [user.id]);
    if (!binding) throw forbidden('请联系管理员绑定 U9 业务员');
    return binding.operator_id;
  }
  router.get('/summary/pdf', asyncHandler(async (req, res) => {
    const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
    const { from, to } = parse(z.object({ from: period, to: period }).strict(), req.query);
    if (from > to) throw badRequest('请选择有效的期间');
    const operatorId = await operatorFor(req.user);
    if (!u9.getSummary) throw new Error('U9 汇总服务未配置');
    const pdf = await summaryPdf(from, to, await u9.getSummary(operatorId, from, to));
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="summary.pdf"', 'Cache-Control': 'no-store' }).send(pdf);
  }));
  router.get('/:kind', asyncHandler(async (req, res) => {
    const kind: U9DocumentKind = parse(kindSchema, req.params.kind);
    const { page } = parse(z.object({ page: z.coerce.number().int().min(1).max(100000).default(1) }).strict(), req.query);
    success(res, await u9.listDocuments(kind, await operatorFor(req.user), page));
  }));
  router.get('/:kind/:id/pdf', asyncHandler(async (req, res) => {
    const kind = parse(kindSchema, req.params.kind);
    const id = parse(z.string().regex(/^\d{1,19}$/), req.params.id);
    parse(z.object({}).strict(), req.query);
    const document = await u9.getDocument(kind, await operatorFor(req.user), id);
    if (!document) throw notFound('单据不存在');
    const pdf = await documentPdf(kind, document);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="document.pdf"', 'Cache-Control': 'no-store' }).send(pdf);
  }));
  router.get('/:kind/:id', asyncHandler(async (req, res) => {
    const kind: U9DocumentKind = parse(kindSchema, req.params.kind);
    const id = parse(z.string().regex(/^\d{1,19}$/), req.params.id);
    parse(z.object({}).strict(), req.query);
    const document = await u9.getDocument(kind, await operatorFor(req.user), id);
    if (!document) throw notFound('单据不存在');
    success(res, document);
  }));
  return router;
}
