import { buildQuery,request } from '../../api/client';
import type {
AdminAttendanceRecord,
AttendanceQuery,
AttendanceResponse,
AttendanceSettings,
ManualPunchInput
} from '../../types';

export function fetchAttendance(params: AttendanceQuery): Promise<AttendanceResponse> {
  return request<AttendanceResponse>(
    `/admin/attendance${buildQuery(params as Record<string, string | undefined>)}`
  );
}

export function fetchAttendanceSettings(): Promise<AttendanceSettings | null> {
  return request<AttendanceSettings | null>('/admin/attendance/settings');
}

export function saveAttendanceSettings(settings: AttendanceSettings): Promise<AttendanceSettings> {
  return request<AttendanceSettings>('/admin/attendance/settings', { method: 'PUT', body: settings });
}

export function saveAttendancePunch(input: ManualPunchInput): Promise<AdminAttendanceRecord> {
  return request<AdminAttendanceRecord>('/admin/attendance/punch', { method: 'POST', body: input });
}
