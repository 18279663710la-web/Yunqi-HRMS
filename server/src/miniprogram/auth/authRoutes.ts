import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from './authMiddleware';
import { parse } from '../../shared/middleware/validate';
import { passwordLogin, refreshSession } from './authService';
import { getCurrentUserById } from '../../domains/employees/userService';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { notFound } from '../../shared/utils/errors';
import { success } from '../../shared/utils/response';

const router = Router();

const passwordLoginSchema = z.object({
  loginName: z.string().trim().min(3).max(50),
  password: z.string().min(1).max(64),
});

router.post(
  '/auth/password-login',
  asyncHandler(async (req, res) => {
    const body = parse(passwordLoginSchema, req.body);
    success(res, await passwordLogin(body.loginName, body.password));
  })
);

const refreshSchema = z.object({ refreshToken: z.string().min(1) });

router.post(
  '/auth/refresh',
  asyncHandler(async (req, res) => {
    const body = parse(refreshSchema, req.body);
    const data = await refreshSession(body.refreshToken);
    success(res, data);
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await getCurrentUserById(req.user.id);
    if (!user) throw notFound('员工不存在');
    success(res, user);
  })
);

export default router;
