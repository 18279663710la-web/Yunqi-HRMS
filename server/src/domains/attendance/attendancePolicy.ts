import { z } from 'zod';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '时间格式应为 HH:mm');
// startTime/endTime 分别是上班卡、下班卡时间段的开始，均可自由设置。
export const attendanceSettingsSchema = z.object({
  startTime: time,
  inEndTime: time,
  endTime: time,
  outEndTime: time,
  restDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, '休息日期无效')).max(1000).default([]),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  radius: z.number().int().min(1).max(10000),
}).refine((value) => value.startTime <= value.inEndTime, { message: '上班卡开始时间不能晚于上班卡结束时间', path: ['inEndTime'] })
  .refine((value) => value.endTime <= value.outEndTime, { message: '下班卡开始时间不能晚于下班卡结束时间', path: ['outEndTime'] })
  .refine((value) => value.inEndTime < value.endTime, { message: '上班卡时间段不能与下班卡时间段重合，且不能晚于下班卡时间段', path: ['endTime'] });

export interface PunchSchedule {
  startTime: string;
  inEndTime: string | null;
  endTime: string;
  outEndTime: string | null;
  restDates: string[];
}

/** 同日时段，开始和结束分钟均可打卡。 */
export function getPunchWindow(settings: PunchSchedule, date: string, currentTime: string): 'in' | 'out' | null {
  if (!settings.inEndTime || !settings.outEndTime || settings.restDates.includes(date)) return null;
  if (currentTime >= settings.startTime && currentTime <= settings.inEndTime) return 'in';
  if (currentTime >= settings.endTime && currentTime <= settings.outEndTime) return 'out';
  return null;
}

export interface Location { latitude: number; longitude: number; accuracy: number }
export interface Site { latitude: number; longitude: number; radius: number }

/** 员工端只看时段和半径。打卡点经纬度留在服务端，避免直接抄回来提交。 */
export function toEmployeeAttendanceSettings<T extends { latitude: number; longitude: number }>(
  settings: T | null
): Omit<T, 'latitude' | 'longitude'> | null {
  if (!settings) return null;
  const { latitude: _latitude, longitude: _longitude, ...view } = settings;
  return view;
}

export function validatePunchLocation(site: Site | null, location?: Location): { ok: boolean; message: string; distance?: number } {
  if (!site) return { ok: false, message: '管理员尚未设置打卡地点' };
  if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude) ||
      !Number.isFinite(location.accuracy) || location.latitude < -90 || location.latitude > 90 ||
      location.longitude < -180 || location.longitude > 180 || location.accuracy <= 0) {
    return { ok: false, message: '请先获取有效定位' };
  }
  if (location.accuracy > site.radius) return { ok: false, message: '定位精度不足，请重试或移动到信号较好的位置' };
  const rad = Math.PI / 180;
  const deltaLat = (location.latitude - site.latitude) * rad;
  const deltaLng = (location.longitude - site.longitude) * rad;
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(site.latitude * rad) * Math.cos(location.latitude * rad) * Math.sin(deltaLng / 2) ** 2;
  const distance = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  // 半径大于 1 米时，与打卡点重合视为抄录坐标，而不是现场定位。
  if (site.radius > 1 && distance < 1) return { ok: false, message: '定位与打卡点重合，请重新获取定位', distance };
  if (distance > site.radius) return { ok: false, message: `不在打卡范围内（距打卡点约 ${Math.round(distance)} 米）`, distance };
  return { ok: true, message: '定位验证通过', distance };
}
