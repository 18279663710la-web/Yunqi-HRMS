import { Router } from 'express';
import { z } from 'zod';

import { attendanceSettingsSchema } from '../../domains/attendance/attendancePolicy';
import {
  attendanceGroupMetaSchema,
  attendanceGroupNameSchema,
  createAttendanceGroup,
  deleteAttendanceGroup,
  listAttendanceGroups,
  renameAttendanceGroup,
  updateAttendanceGroup,
} from '../../domains/attendance/attendanceGroups';
import { getAttendanceSettings, saveAttendanceSettings } from '../../domains/attendance/attendanceSettings';
import { parse } from '../../shared/middleware/validate';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { success } from '../../shared/utils/response';
import {
getAdminAttendance,
updateAttendancePunch
} from './adminAttendanceService';
import { adminOf } from '../adminContext';

const router = Router();

/* ---------------- 考勤 ---------------- */

router.get('/attendance/settings', asyncHandler(async (_req, res) => {
  success(res, await getAttendanceSettings());
}));

router.put('/attendance/settings', asyncHandler(async (req, res) => {
  const body = parse(attendanceSettingsSchema, req.body);
  success(res, await saveAttendanceSettings(body, adminOf(req)));
}));

const groupIdSchema = z.coerce.number().int().positive();

router.get('/attendance/groups', asyncHandler(async (_req, res) => {
  success(res, await listAttendanceGroups());
}));

router.post('/attendance/groups', asyncHandler(async (req, res) => {
  const settings = parse(attendanceSettingsSchema, req.body);
  const meta = parse(attendanceGroupMetaSchema, req.body);
  success(res, await createAttendanceGroup({ ...settings, ...meta }, adminOf(req)));
}));

router.put('/attendance/groups/:id', asyncHandler(async (req, res) => {
  const id = parse(groupIdSchema, req.params.id);
  const settings = parse(attendanceSettingsSchema, req.body);
  const meta = parse(attendanceGroupMetaSchema, req.body);
  success(res, await updateAttendanceGroup(id, { ...settings, ...meta }, adminOf(req)));
}));

router.patch('/attendance/groups/:id/name', asyncHandler(async (req, res) => {
  const id = parse(groupIdSchema, req.params.id);
  const body = parse(z.object({ name: attendanceGroupNameSchema }), req.body);
  success(res, await renameAttendanceGroup(id, body.name, adminOf(req)));
}));

router.delete('/attendance/groups/:id', asyncHandler(async (req, res) => {
  const id = parse(groupIdSchema, req.params.id);
  await deleteAttendanceGroup(id, adminOf(req));
  success(res, null);
}));

router.get(
  '/attendance',
  asyncHandler(async (req, res) => {
    const rawJob = String(req.query.jobCategory || '');
    const jobCategory = rawJob || undefined;
    success(
      res,
      await getAdminAttendance({
        month: String(req.query.month || ''),
        date: String(req.query.date || ''),
        deptId: String(req.query.deptId || ''),
        jobCategory,
        employeeId: String(req.query.employeeId || ''),
        status: String(req.query.status || 'all'),
      })
    );
  })
);

const punchSchema = z.object({
  employeeId: z.string().min(1).max(10),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkIn: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  checkOut: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  statusOverride: z.enum(['leave', 'absent', 'rest']).nullable().optional(),
  note: z.string().max(200).optional(),
});

router.post(
  '/attendance/punch',
  asyncHandler(async (req, res) => {
    const body = parse(punchSchema, req.body);
    success(res, await updateAttendancePunch(body, adminOf(req)));
  })
);


export default router;
