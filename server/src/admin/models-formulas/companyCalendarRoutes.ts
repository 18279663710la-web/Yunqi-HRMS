import { Router } from 'express';
import { z } from 'zod';

import { requireAdmin, requireSuperAdmin } from '../admin-accounts/authMiddleware';
import {
  companyCalendarRuleSchema,
  createCompanyCalendarRule,
  deleteCompanyCalendarRule,
  listCompanyCalendarRules,
  updateCompanyCalendarRule,
} from '../../domains/attendance/companyCalendar';
import { parse } from '../../shared/middleware/validate';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { success } from '../../shared/utils/response';
import { adminOf } from '../adminContext';

const router = Router();
// 考勤组编辑需要读取可选的日历规则；新建、修改和删除仍仅限超级管理员。
router.use(requireAdmin);

const idSchema = z.coerce.number().int().positive();

router.get('/calendar-rules', asyncHandler(async (_req, res) => {
  success(res, await listCompanyCalendarRules());
}));

router.post('/calendar-rules', requireSuperAdmin, asyncHandler(async (req, res) => {
  const body = parse(companyCalendarRuleSchema, req.body);
  success(res, await createCompanyCalendarRule(body, adminOf(req)));
}));

router.put('/calendar-rules/:id', requireSuperAdmin, asyncHandler(async (req, res) => {
  const id = parse(idSchema, req.params.id);
  const body = parse(companyCalendarRuleSchema, req.body);
  success(res, await updateCompanyCalendarRule(id, body, adminOf(req)));
}));

router.delete('/calendar-rules/:id', requireSuperAdmin, asyncHandler(async (req, res) => {
  const id = parse(idSchema, req.params.id);
  await deleteCompanyCalendarRule(id, adminOf(req));
  success(res, null);
}));

export default router;
