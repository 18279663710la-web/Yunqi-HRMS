import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/authMiddleware';
import { queryOne, queryRows, execute } from '../../shared/db/pool';
import { parse } from '../../shared/middleware/validate';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { conflict, notFound } from '../../shared/utils/errors';
import { success } from '../../shared/utils/response';

const router = Router();
const idSchema = z.coerce.number().int().positive().safe();
router.use(requireAuth);
router.get('/', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const rows = await queryRows<{ id: number; month: string; revision: number; readAt: string | null; sentAt: string }>(`SELECT p.id, b.payroll_month AS month, p.revision, p.read_at AS readAt, p.sent_at AS sentAt
    FROM hr_payroll_payslips p JOIN hr_payroll_batches b ON b.id = p.batch_id WHERE p.employee_id = ? ORDER BY p.sent_at DESC, p.id DESC`, [req.user.id]);
  success(res, rows.map(row => ({ id: Number(row.id), month: row.month, revision: Number(row.revision), read: !!row.readAt, sentAt: row.sentAt })));
}));
router.get('/:id/pdf', asyncHandler(async (req, res) => {
  const row = await queryOne<{ pdf: Buffer }>('SELECT pdf_data AS pdf FROM hr_payroll_payslips WHERE id = ? AND employee_id = ?', [parse(idSchema, req.params.id), req.user.id]);
  if (!row) throw notFound('工资条不存在');
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="payslip.pdf"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.send(row.pdf);
}));
router.post('/:id/read', asyncHandler(async (req, res) => {
  const id = parse(idSchema, req.params.id);
  const input = parse(z.object({ revision: z.number().int().positive().safe() }).strict(), req.body);
  const result = await execute('UPDATE hr_payroll_payslips SET read_at = COALESCE(read_at, NOW()) WHERE id = ? AND employee_id = ? AND revision = ?', [id, req.user.id, input.revision]);
  if (!result.affectedRows) {
    const row = await queryOne('SELECT id FROM hr_payroll_payslips WHERE id = ? AND employee_id = ?', [id, req.user.id]);
    if (!row) throw notFound('工资条不存在');
    throw conflict('工资条已重新发送，请重新查看');
  }
  success(res, {});
}));
export default router;
