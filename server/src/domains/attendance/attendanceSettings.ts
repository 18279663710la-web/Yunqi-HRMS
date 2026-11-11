import { z } from 'zod';
import { queryOne, transaction } from '../../shared/db/pool';
import type { AdminUser } from '../../shared/types/admin';
import { recordAdminLog } from '../audit/adminLogService';
import { attendanceSettingsSchema } from './attendancePolicy';

export type AttendanceSettingsInput = z.infer<typeof attendanceSettingsSchema>;
export type AttendanceSettings = Omit<AttendanceSettingsInput, 'inEndTime' | 'outEndTime'> & {
  inEndTime: string | null;
  outEndTime: string | null;
};

export interface AttendanceSettingsRow {
  start_time: string;
  in_end_time: string | null;
  end_time: string;
  out_end_time: string | null;
  rest_dates: string | string[] | null;
  latitude: number;
  longitude: number;
  radius: number;
}

export function mapAttendanceSettingsRow(row: AttendanceSettingsRow): AttendanceSettings {
  const restDates = row.rest_dates
    ? (typeof row.rest_dates === 'string' ? JSON.parse(row.rest_dates) as string[] : row.rest_dates)
    : [];
  return {
    startTime: row.start_time,
    inEndTime: row.in_end_time,
    endTime: row.end_time,
    outEndTime: row.out_end_time,
    restDates,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    radius: Number(row.radius),
  };
}

export async function getAttendanceSettings(): Promise<AttendanceSettings | null> {
  const row = await queryOne<AttendanceSettingsRow>('SELECT * FROM attendance_settings WHERE id = 1');
  return row ? mapAttendanceSettingsRow(row) : null;
}

export async function saveAttendanceSettings(input: AttendanceSettingsInput, admin: AdminUser): Promise<AttendanceSettingsInput> {
  const settings = attendanceSettingsSchema.parse(input);
  await transaction(async (conn) => {
    await conn.query(`INSERT INTO attendance_settings (id, start_time, in_end_time, end_time, out_end_time, rest_dates, latitude, longitude, radius)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE start_time=VALUES(start_time), in_end_time=VALUES(in_end_time),
      end_time=VALUES(end_time), out_end_time=VALUES(out_end_time), rest_dates=VALUES(rest_dates),
      latitude=VALUES(latitude), longitude=VALUES(longitude), radius=VALUES(radius)`,
      [settings.startTime, settings.inEndTime, settings.endTime, settings.outEndTime, JSON.stringify(settings.restDates), settings.latitude, settings.longitude, settings.radius]);
  });
  await recordAdminLog(admin, '修改考勤设置', 'attendance_settings', '1', settings);
  return settings;
}
