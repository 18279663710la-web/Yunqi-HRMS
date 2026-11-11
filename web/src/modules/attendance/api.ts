import { buildQuery,request } from '../../api/client';
import type {
AdminAttendanceRecord,
AttendanceGroup,
AttendanceGroupInput,
AttendanceGroupsResponse,
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

export function fetchAttendanceGroups(): Promise<AttendanceGroupsResponse> {
  return request<AttendanceGroupsResponse>('/admin/attendance/groups');
}

export function createAttendanceGroup(input: AttendanceGroupInput): Promise<AttendanceGroup> {
  return request<AttendanceGroup>('/admin/attendance/groups', { method: 'POST', body: input });
}

export function updateAttendanceGroup(id: number, input: AttendanceGroupInput): Promise<AttendanceGroup> {
  return request<AttendanceGroup>(`/admin/attendance/groups/${id}`, { method: 'PUT', body: input });
}

export function renameAttendanceGroup(id: number, name: string): Promise<AttendanceGroup> {
  return request<AttendanceGroup>(`/admin/attendance/groups/${id}/name`, { method: 'PATCH', body: { name } });
}

export function deleteAttendanceGroup(id: number): Promise<null> {
  return request<null>(`/admin/attendance/groups/${id}`, { method: 'DELETE' });
}

export function saveAttendancePunch(input: ManualPunchInput): Promise<AdminAttendanceRecord> {
  return request<AdminAttendanceRecord>('/admin/attendance/punch', { method: 'POST', body: input });
}
