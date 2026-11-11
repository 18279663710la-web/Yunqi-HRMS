import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../auth/authMiddleware';
import { parse } from '../../shared/middleware/validate';
import {
  getAttendanceRecords,
  getAttendanceStats,
  getTodayAttendance,
  punch,
} from '../../domains/attendance/attendanceService';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { success } from '../../shared/utils/response';
import { getAttendanceSettingsForEmployee } from '../../domains/attendance/attendanceGroups';
import { listOvertimePunches, punchOvertime } from '../../domains/attendance/overtimeAttendanceService';

const router = Router();
router.use(requireAuth);

router.get('/settings', asyncHandler(async (req, res) => {
  success(res, await getAttendanceSettingsForEmployee(req.user.id));
}));

router.get('/overtime', asyncHandler(async (req, res) => { success(res, await listOvertimePunches(req.user.id)); }));
router.post('/overtime/punch', asyncHandler(async (req, res) => {
  const body = parse(z.object({ approvalId: z.string().min(1).max(30), type: z.enum(['in', 'out']), latitude: z.number().optional(), longitude: z.number().optional(), accuracy: z.number().optional() }), req.body);
  success(res, await punchOvertime(req.user.id, body.approvalId, body.type, body.latitude !== undefined && body.longitude !== undefined && body.accuracy !== undefined ? { latitude: body.latitude, longitude: body.longitude, accuracy: body.accuracy } : undefined));
}));

router.get(
  '/today',
  asyncHandler(async (req, res) => {
    success(res, await getTodayAttendance(req.user.id));
  })
);

const punchSchema = z.object({
  type: z.enum(['in', 'out']),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  accuracy: z.number().optional(),
});

router.post(
  '/punch',
  asyncHandler(async (req, res) => {
    const body = parse(punchSchema, req.body);
    success(res, await punch(req.user.id, body.type, body.latitude !== undefined && body.longitude !== undefined && body.accuracy !== undefined
      ? { latitude: body.latitude, longitude: body.longitude, accuracy: body.accuracy } : undefined));
  })
);

router.get(
  '/records',
  asyncHandler(async (req, res) => {
    const days = Number(req.query.days || 14);
    success(res, await getAttendanceRecords(req.user.id, Number.isFinite(days) ? days : 14));
  })
);

router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    success(res, await getAttendanceStats(req.user.id));
  })
);

export default router;
