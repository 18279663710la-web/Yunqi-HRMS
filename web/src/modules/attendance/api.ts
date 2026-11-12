import { buildQuery,fetchProtectedObjectUrl,request } from '../../api/client';
import type {
AdminAttendanceRecord,
AdminVisitResponse,
AttendanceGroup,
AttendanceGroupInput,
AttendanceGroupsResponse,
AttendanceQuery,
AttendanceResponse,
AttendanceSettings,
ManualPunchInput,
VisitQuery
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

export function deleteAttendanceGroup(id: number): Promise<null> {
  return request<null>(`/admin/attendance/groups/${id}`, { method: 'DELETE' });
}

export function saveAttendancePunch(input: ManualPunchInput): Promise<AdminAttendanceRecord> {
  return request<AdminAttendanceRecord>('/admin/attendance/punch', { method: 'POST', body: input });
}

export function fetchVisits(params: VisitQuery): Promise<AdminVisitResponse> {
  return request<AdminVisitResponse>(`/admin/attendance/visits${buildQuery(params as Record<string, string | number | undefined>)}`);
}

export function fetchVisitPhotoUrl(id: string): Promise<string> {
  return fetchProtectedObjectUrl(`/admin/attendance/visits/photos/${id}`);
}
