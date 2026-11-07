import { Router } from 'express';
import { z } from 'zod';

import { createChairpersonAccount,getChairpersonAccount } from '../../domains/accounts/chairpersonService';
import { requireSuperAdmin } from '../admin-accounts/authMiddleware';
import { parse } from '../../shared/middleware/validate';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { notFound } from '../../shared/utils/errors';
import { success } from '../../shared/utils/response';
import {
createEmployee,
getAdminEmployeeById,
getAdminEmployeeGroups,
getAdminEmployeeList,
getAdminJobCategories,
getAllEmployeesForSelect,
resetEmployeeAccountPassword,
setEmployeeAccountStatus,
updateEmployee,
upsertEmployeeAccount
} from './adminEmployeeService';
import { adminOf } from '../adminContext';
import { createJobTitle, deleteJobTitle, listAdminJobTitles } from '../../domains/employees/jobTitleService';
import { recordAdminLog } from '../../domains/audit/adminLogService';

const router = Router();

router.get('/job-titles', asyncHandler(async (_req, res) => { success(res, await listAdminJobTitles()); }));
router.post('/job-titles', asyncHandler(async (req, res) => {
  const { name } = parse(z.object({ name: z.string().trim().min(1).max(100) }), req.body);
  const title = await createJobTitle(name);
  await recordAdminLog(adminOf(req), '创建职务', 'job_title', String(title.id), { name });
  success(res, title);
}));
router.delete('/job-titles/:id', asyncHandler(async (req, res) => {
  const id = parse(z.coerce.number().int().positive().safe(), req.params.id);
  await deleteJobTitle(id);
  await recordAdminLog(adminOf(req), '删除职务', 'job_title', String(id), {});
  success(res, {});
}));

/* ---------------- 员工与账号 ---------------- */

router.get('/chairperson-account', requireSuperAdmin, asyncHandler(async (_req, res) => {
  const account = await getChairpersonAccount();
  success(res, account ? { loginName: account.login_name, status: account.status } : null);
}));

router.post('/chairperson-account', requireSuperAdmin, asyncHandler(async (req, res) => {
  const body = parse(z.object({
    loginName: z.string().trim().regex(/^[A-Za-z0-9_.-]{3,30}$/),
    password: z.string().min(6).max(64),
  }), req.body);
  success(res, await createChairpersonAccount(body, adminOf(req)));
}));

router.get(
  '/employees/options',
  asyncHandler(async (_req, res) => {
    success(res, await getAllEmployeesForSelect());
  })
);

router.get(
  '/employee-groups',
  asyncHandler(async (req, res) => {
    success(res, await getAdminEmployeeGroups(String(req.query.deptId || '')));
  })
);

router.get(
  '/job-categories',
  asyncHandler(async (_req, res) => {
    success(res, await getAdminJobCategories());
  })
);

router.get(
  '/employees',
  asyncHandler(async (req, res) => {
    const rawStatus = String(req.query.accountStatus || 'all');
    const accountStatus =
      rawStatus === 'active' || rawStatus === 'disabled' || rawStatus === 'none' ? rawStatus : 'all';
    const rawJob = String(req.query.jobCategory || '');
    const jobCategory =
      rawJob === '研发员' || rawJob === '业务员' || rawJob === '员工' ? rawJob : undefined;
    success(
      res,
      await getAdminEmployeeList({
        keyword: String(req.query.keyword || ''),
        deptId: String(req.query.deptId || ''),
        jobCategory,
        accountStatus,
        page: Number(req.query.page || 1),
        pageSize: Number(req.query.pageSize || 20),
      })
    );
  })
);

const employeeSchema = z.object({
  name: z.string().trim().min(1).max(50),
  pinyin: z.string().trim().regex(/^[a-zA-Z]+$/, '拼音只能包含字母').max(100),
  gender: z.enum(['男', '女']).optional(),
  deptId: z.string().trim().min(1).max(10),
  position: z.string().trim().min(1).max(100),
  jobCategory: z.enum(['研发员', '业务员', '员工']).optional(),
  level: z.string().trim().min(1).max(20),
  employeeNo: z.string().trim().min(1).max(30),
  phone: z.string().trim().min(5).max(20),
  email: z.string().trim().max(100).optional(),
  joinDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '入职日期格式应为 YYYY-MM-DD'),
  isLeader: z.boolean().optional(),
  seat: z.string().trim().max(50).optional(),
  leaderId: z.string().trim().max(10).optional(),
});

const accountSchema = z.object({
  loginName: z.string().trim().regex(/^[A-Za-z0-9_.-]{3,30}$/, '登录名需为 3-30 位字母、数字、下划线、点或短横线'),
  password: z.string().min(6).max(64),
  status: z.enum(['active', 'disabled']).optional(),
});

const createEmployeeSchema = employeeSchema.extend({
  jobCategory: z.enum(['研发员', '业务员', '员工']),
  account: accountSchema.optional(),
});

router.post(
  '/employees',
  asyncHandler(async (req, res) => {
    const body = parse(createEmployeeSchema, req.body);
    success(res, await createEmployee(body, adminOf(req)));
  })
);

router.get(
  '/employees/:id',
  asyncHandler(async (req, res) => {
    const employee = await getAdminEmployeeById(req.params.id);
    if (!employee) throw notFound('员工不存在');
    success(res, employee);
  })
);

router.put(
  '/employees/:id',
  asyncHandler(async (req, res) => {
    const body = parse(employeeSchema, req.body);
    success(res, await updateEmployee(req.params.id, body, adminOf(req)));
  })
);

router.post(
  '/employees/:id/account',
  asyncHandler(async (req, res) => {
    const body = parse(accountSchema, req.body);
    success(res, await upsertEmployeeAccount(req.params.id, body, adminOf(req)));
  })
);

router.patch(
  '/employees/:id/account/status',
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ status: z.enum(['active', 'disabled']) }), req.body);
    success(res, await setEmployeeAccountStatus(req.params.id, body.status, adminOf(req)));
  })
);

router.post(
  '/employees/:id/account/reset-password',
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ password: z.string().min(6).max(64) }), req.body);
    await resetEmployeeAccountPassword(req.params.id, body.password, adminOf(req));
    success(res, { ok: true });
  })
);


export default router;
