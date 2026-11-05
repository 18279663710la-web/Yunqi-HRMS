import { Router } from 'express';
import { z } from 'zod';

import { requireSuperAdmin } from './authMiddleware';
import { parse } from '../../shared/middleware/validate';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { success } from '../../shared/utils/response';
import { adminOf } from '../adminContext';
import {
createAdmin,
listAdmins,
resetAdminPassword,
setAdminStatus
} from './adminAuthService';

const router = Router();

/* ---------------- 管理员账号（仅超级管理员） ---------------- */

router.get(
  '/admins',
  requireSuperAdmin,
  asyncHandler(async (_req, res) => {
    success(res, await listAdmins());
  })
);

const createAdminSchema = z.object({
  username: z.string().trim().regex(/^[A-Za-z0-9_.-]{3,30}$/, '登录名需为 3-30 位字母、数字、下划线、点或短横线'),
  password: z.string().min(6).max(64),
  name: z.string().trim().min(1).max(50),
  role: z.enum(['super_admin', 'hr_admin']),
});

router.post(
  '/admins',
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const body = parse(createAdminSchema, req.body);
    success(res, await createAdmin(body, adminOf(req)));
  })
);

router.patch(
  '/admins/:id/status',
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ status: z.boolean() }), req.body);
    success(res, await setAdminStatus(Number(req.params.id), body.status, adminOf(req)));
  })
);

router.post(
  '/admins/:id/reset-password',
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ password: z.string().min(6).max(64) }), req.body);
    await resetAdminPassword(Number(req.params.id), body.password, adminOf(req));
    success(res, { ok: true });
  })
);


export default router;
