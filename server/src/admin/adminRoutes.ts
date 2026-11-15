import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from './admin-accounts/authMiddleware';
import { parse } from '../shared/middleware/validate';
import { asyncHandler } from '../shared/utils/asyncHandler';
import { success } from '../shared/utils/response';
import { withLoginAttempt } from '../shared/middleware/loginAttempts';
import { loginAdmin } from './admin-accounts/adminAuthService';
import approvalRoutes from './approvals/routes';
import sessionRoutes from './admin-accounts/sessionRoutes';
import dashboardRoutes from './dashboard/routes';
import employeeRoutes from './employees/routes';
import attendanceRoutes from './attendance/routes';
import accountRoutes from './admin-accounts/routes';

const router = Router();
const loginSchema = z.object({
  username: z.string().trim().min(1).max(50),
  password: z.string().min(1).max(64),
});

router.post(
  '/auth/login',
  asyncHandler(async (req, res) => {
    const body = parse(loginSchema, req.body);
    success(res, await withLoginAttempt('admin', req.ip || '', body.username, () => loginAdmin(body.username, body.password)));
  })
);


router.use(requireAdmin);
router.use(approvalRoutes);
router.use(sessionRoutes);
router.use(dashboardRoutes);
router.use(employeeRoutes);
router.use(attendanceRoutes);
router.use(accountRoutes);
export default router;
