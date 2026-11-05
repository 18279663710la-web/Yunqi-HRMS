import type {
AttendanceRecord,
AttendanceStats,
PunchResult,
TodayAttendance
} from '../../types/models';
import {
get,
post
} from '../../utils/request';

export function getTodayAttendance(): Promise<TodayAttendance> {
  return get<TodayAttendance>('/attendance/today');
}

export function punch(type: 'in' | 'out', location?: { latitude?: number; longitude?: number; accuracy?: number }): Promise<PunchResult> {
  return post<PunchResult>('/attendance/punch', { type, ...(location || {}) });
}

export function getOvertimePunches(): Promise<import('../../types/models').OvertimePunch[]> { return get('/attendance/overtime'); }

export function punchOvertime(approvalId: string, type: 'in' | 'out', location: { latitude?: number; longitude?: number; accuracy?: number }): Promise<PunchResult> { return post('/attendance/overtime/punch', { approvalId, type, ...location }); }

export function getAttendanceSettings(): Promise<import('../../types/models').AttendanceSettings | null> {
  return get<import('../../types/models').AttendanceSettings | null>('/attendance/settings');
}

export function getAttendanceRecords(days = 14): Promise<AttendanceRecord[]> {
  return get<AttendanceRecord[]>('/attendance/records', { days });
}

export function getAttendanceStats(): Promise<AttendanceStats> {
  return get<AttendanceStats>('/attendance/stats');
}
