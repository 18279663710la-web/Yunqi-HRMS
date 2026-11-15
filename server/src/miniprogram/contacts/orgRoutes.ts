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
import { listJobTitles } from '../../domains/employees/jobTitleService';

const router = Router();
router.get('/job-titles', requireAuth, asyncHandler(async (_req, res) => { success(res, await listJobTitles()); }));

router.get(
  '/departments/tree',
  requireAuth,
  asyncHandler(async (_req, res) => {
    success(res, await getDepartmentTree());
  })
);

router.get(
  '/departments',
  requireAuth,
  asyncHandler(async (_req, res) => {
    success(res, await getDepartmentList());
  })
);

router.get(
  '/employees',
  requireAuth,
  asyncHandler(async (req, res) => {
    const deptId = String(req.query.deptId || '');
    const keyword = String(req.query.keyword || '');
    success(res, await getEmployeeList({ deptId, keyword, jobTitle: String(req.query.jobTitle || '') }));
  })
);

router.get(
  '/employees/groups',
  requireAuth,
  asyncHandler(async (req, res) => {
    const deptId = String(req.query.deptId || '');
    const keyword = String(req.query.keyword || '');
    success(res, await getEmployeeGroups({ deptId, keyword, jobTitle: String(req.query.jobTitle || '') }));
  })
);

router.get(
  '/employees/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const detail = await getEmployeeDetail(req.params.id);
    if (!detail) throw notFound('未找到该同事的信息');
    success(res, detail);
  })
);

export default router;
