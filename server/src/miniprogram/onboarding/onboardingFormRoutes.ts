import { Router } from 'express';
import { getPendingOnboarding, submitOnboarding } from '../../domains/onboarding/employeeOnboardingService';
import { requireAuth } from '../auth/authMiddleware';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { success } from '../../shared/utils/response';

const employee = Router();
employee.use(requireAuth);
employee.get('/pending', asyncHandler(async (req, res) => {
  success(res, await getPendingOnboarding(req.user.id));
}));
employee.post('/submit', asyncHandler(async (req, res) => {
  await submitOnboarding(req.user.id, req.body);
  success(res, {});
}));

export default employee;
