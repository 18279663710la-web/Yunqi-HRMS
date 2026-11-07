import { Router } from 'express';
import { z } from 'zod';
import type { U9Gateway } from '../../domains/u9/types';
import { queryOne, transaction } from '../../shared/db/pool';
import { parse } from '../../shared/middleware/validate';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { badRequest, conflict } from '../../shared/utils/errors';
import { success } from '../../shared/utils/response';
import { requireSuperAdmin } from '../admin-accounts/authMiddleware';
import { adminOf } from '../adminContext';
import { recordAdminLog } from '../../domains/audit/adminLogService';

const employeeIdSchema = z.string().trim().min(1).max(10);
const operatorIdSchema = z.string().regex(/^\d{1,19}$/);

export function createU9AdminRouter(u9: U9Gateway): Router {
  const router = Router();
  router.use(requireSuperAdmin);
  router.get('/operators', asyncHandler(async (req, res) => {
    const { keyword } = parse(z.object({ keyword: z.string().trim().max(50).optional() }).strict(), req.query);
    success(res, await u9.searchOperators(keyword || ''));
  }));
  router.get('/bindings/:employeeId', asyncHandler(async (req, res) => {
    const employeeId = parse(employeeIdSchema, req.params.employeeId);
    const row = await queryOne<{ operator_id: string }>('SELECT operator_id FROM u9_employee_bindings WHERE employee_id = ?', [employeeId]);
    success(res, row ? await u9.getOperator(row.operator_id) : null);
  }));
  router.put('/bindings/:employeeId', asyncHandler(async (req, res) => {
    const employeeId = parse(employeeIdSchema, req.params.employeeId);
    const { operatorId } = parse(z.object({ operatorId: operatorIdSchema }).strict(), req.body);
    const operator = await u9.getOperator(operatorId);
    if (!operator) throw badRequest('U9 业务员不存在');
    await transaction(async conn => {
      const [rows] = await conn.query<import('mysql2').RowDataPacket[]>(
        `SELECT e.position, EXISTS(SELECT 1 FROM hr_employee_departures d WHERE d.employee_id=e.id AND d.status='departed') AS departed FROM employees e WHERE e.id=? FOR UPDATE`, [employeeId]
      );
      if (!rows.length || rows[0].position !== '业务员' || Number(rows[0].departed)) throw badRequest('只能为在职业务员绑定 U9 业务员');
      await conn.query('INSERT INTO u9_employee_bindings (employee_id,operator_id,updated_at) VALUES (?,?,NOW()) ON DUPLICATE KEY UPDATE operator_id=IF(employee_id=VALUES(employee_id),VALUES(operator_id),operator_id), updated_at=IF(employee_id=VALUES(employee_id),NOW(),updated_at)', [employeeId, operatorId]);
      const [bound] = await conn.query<import('mysql2').RowDataPacket[]>('SELECT operator_id FROM u9_employee_bindings WHERE employee_id=?', [employeeId]);
      if (!bound.length || bound[0].operator_id !== operatorId) throw conflict('该 U9 业务员已绑定其他员工');
    });
    await recordAdminLog(adminOf(req), '绑定 U9 业务员', 'employee', employeeId, { operatorId });
    success(res, operator);
  }));
  router.delete('/bindings/:employeeId', asyncHandler(async (req, res) => {
    const employeeId = parse(employeeIdSchema, req.params.employeeId);
    await transaction(async conn => { await conn.query('DELETE FROM u9_employee_bindings WHERE employee_id=?', [employeeId]); });
    await recordAdminLog(adminOf(req), '解除 U9 业务员绑定', 'employee', employeeId, {});
    success(res, {});
  }));
  return router;
}
