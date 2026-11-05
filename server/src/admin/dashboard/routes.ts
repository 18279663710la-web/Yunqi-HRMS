import { Router } from 'express';

import { asyncHandler } from '../../shared/utils/asyncHandler';
import { success } from '../../shared/utils/response';
import { getAdminDashboard } from '../attendance/adminAttendanceService';
import { getAdminDepartmentTree } from '../employees/adminEmployeeService';
import { listAdminLogs } from '../../domains/audit/adminLogService';

const router = Router();

/* ---------------- 仪表盘 / 组织 ---------------- */

router.get(
  '/dashboard',
  asyncHandler(async (_req, res) => {
    success(res, await getAdminDashboard());
  })
);

router.get(
  '/departments',
  asyncHandler(async (_req, res) => {
    success(res, await getAdminDepartmentTree());
  })
);

router.get(
  '/logs',
  asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit || 20);
    success(res, await listAdminLogs(limit));
  })
);


export default router;
