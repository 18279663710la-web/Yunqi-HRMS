import type {
AttendanceRecord,
AttendanceStats,
PunchResult,
TodayAttendance,
VisitLocation,
VisitPhotoRef,
VisitRecord
} from '../../types/models';
import {
getBaseUrl,
get,
getToken,
post,
upload
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

export interface VisitInput {
  customerName: string;
  purpose: string;
  addressName?: string;
  address: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  remark?: string;
  photoIds: string[];
}

export function reverseVisitLocation(latitude: number, longitude: number): Promise<VisitLocation> {
  return get<VisitLocation>('/attendance/visits/location', { latitude, longitude }, { silent: true });
}

export function uploadVisitPhoto(filePath: string): Promise<VisitPhotoRef> {
  return upload<VisitPhotoRef>({ url: '/attendance/visits/photos', filePath, name: 'file' });
}

export function createVisit(input: VisitInput): Promise<VisitRecord> {
  return post<VisitRecord>('/attendance/visits', input);
}

export function getMyVisits(month?: string): Promise<{ month: string; list: VisitRecord[] }> {
  return get<{ month: string; list: VisitRecord[] }>('/attendance/visits', month ? { month } : {});
}

export function downloadVisitPhoto(id: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const token = getToken();
    if (!token) { reject({ code: 401, message: '请先登录' }); return; }
    wx.downloadFile({
      url: `${getBaseUrl()}/attendance/visits/photos/${id}`,
      header: { Authorization: `Bearer ${token}` },
      timeout: 15000,
      success: (result) => {
        if (result.statusCode === 200 && result.tempFilePath) resolve(result.tempFilePath);
        else reject({ code: result.statusCode, message: '照片加载失败，请重试' });
      },
      fail: () => reject({ code: -1, message: '照片加载失败，请检查网络' }),
    });
  });
}
