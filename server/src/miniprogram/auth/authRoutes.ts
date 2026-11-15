import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from './authMiddleware';
import { withLoginAttempt } from '../../shared/middleware/loginAttempts';
import { parse } from '../../shared/middleware/validate';
import { passwordLogin, refreshSession } from './authService';
import { isWechatConfigured, wechatBind, wechatBindingOf, wechatLogin, wechatUnbind } from './wechatAuthService';
import { getCurrentUserById } from '../../domains/employees/userService';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { notFound } from '../../shared/utils/errors';
import { success } from '../../shared/utils/response';

const router = Router();

const passwordLoginSchema = z.object({
  loginName: z.string().trim().min(3).max(50),
  password: z.string().min(1).max(64),
  /** 7天免登录；未传或 true 时会话 7 天，false 时 1 天 */
  remember: z.boolean().optional(),
});

router.post(
  '/auth/password-login',
  asyncHandler(async (req, res) => {
    const body = parse(passwordLoginSchema, req.body);
    success(res, await withLoginAttempt('employee', req.ip || '', body.loginName, () => passwordLogin(body.loginName, body.password, body.remember ?? true)));
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

/* ---------------- 微信一键登录（绑定后免密；未配置密钥时接口拒绝、前端隐藏入口） ---------------- */

const wechatLoginSchema = z.object({
  code: z.string().trim().min(1).max(500),
});

router.post(
  '/auth/wechat-login',
  asyncHandler(async (req, res) => {
    const body = parse(wechatLoginSchema, req.body);
    success(res, await wechatLogin(body.code));
  })
);

router.get(
  '/auth/wechat-status',
  asyncHandler(async (_req, res) => {
    success(res, { configured: isWechatConfigured() });
  })
);

router.get(
  '/auth/wechat-binding',
  requireAuth,
  asyncHandler(async (req, res) => {
    success(res, await wechatBindingOf(req.user.id));
  })
);

router.post(
  '/auth/wechat-bind',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parse(wechatLoginSchema, req.body);
    success(res, await wechatBind(req.user.id, body.code));
  })
);

router.post(
  '/auth/wechat-unbind',
  requireAuth,
  asyncHandler(async (req, res) => {
    success(res, await wechatUnbind(req.user.id));
  })
);

export default router;
