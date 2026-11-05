import { Router } from 'express';

import { requireAuth } from '../auth/authMiddleware';
import {
  getDepartmentList,
  getDepartmentTree,
  getEmployeeDetail,
  getEmployeeGroups,
  getEmployeeList,
} from '../../domains/employees/userService';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { notFound } from '../../shared/utils/errors';
import { success } from '../../shared/utils/response';

const router = Router();
router.use(requireAuth);

router.get(
  '/departments/tree',
  asyncHandler(async (_req, res) => {
    success(res, await getDepartmentTree());
  })
);

router.get(
  '/departments',
  asyncHandler(async (_req, res) => {
    success(res, await getDepartmentList());
  })
);

router.get(
  '/employees',
  asyncHandler(async (req, res) => {
    const deptId = String(req.query.deptId || '');
    const keyword = String(req.query.keyword || '');
    success(res, await getEmployeeList({ deptId, keyword }));
  })
);

router.get(
  '/employees/groups',
  asyncHandler(async (req, res) => {
    const deptId = String(req.query.deptId || '');
    const keyword = String(req.query.keyword || '');
    success(res, await getEmployeeGroups({ deptId, keyword }));
  })
);

router.get(
  '/employees/:id',
  asyncHandler(async (req, res) => {
    const detail = await getEmployeeDetail(req.params.id);
    if (!detail) throw notFound('未找到该同事的信息');
    success(res, detail);
  })
);

export default router;
