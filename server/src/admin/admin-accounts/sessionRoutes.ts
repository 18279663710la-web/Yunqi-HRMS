import { Router } from 'express';
import { z } from 'zod';

import { parse } from '../../shared/middleware/validate';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { success } from '../../shared/utils/response';
import { adminOf } from '../adminContext';
import {
changeAdminPassword
} from './adminAuthService';

const router = Router();

router.get(
  '/auth/me',
  asyncHandler(async (req, res) => {
    success(res, adminOf(req));
  })
);

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1).max(64),
  newPassword: z.string().min(6).max(64),
});

router.post(
  '/auth/change-password',
  asyncHandler(async (req, res) => {
    const body = parse(changePasswordSchema, req.body);
    await changeAdminPassword(adminOf(req).id, body.oldPassword, body.newPassword);
    success(res, { ok: true });
  })
);


export default router;
