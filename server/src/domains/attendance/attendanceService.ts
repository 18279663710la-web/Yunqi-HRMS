import { queryOne, queryRows, transaction } from '../../shared/db/pool';
import type {
  AttendanceRecord,
  AttendanceStats,
  AttendanceSummary,
  PunchResult,
  PunchType,
  TodayAttendance,
} from '../../shared/types/models';
import {
  calcDuration,
  dateKey,
  formatTime,
  parseDateKey,
  weekdayCn,
  weekdayFullCn,
} from '../../shared/utils/datetime';
import { badRequest } from '../../shared/utils/errors';
import { getCompany } from '../employees/userService';
import { getAttendanceConfigForEmployee, type EmployeeAttendanceConfig } from './attendanceGroups';
import { resolveConfiguredRestDates } from './companyCalendar';
import { getTravelDatesForEmployee } from './travelAttendanceService';
import { getLeaveDatesForEmployee } from './leaveAttendanceService';
import type { AttendanceSettings } from './attendanceSettings';
import { getPunchWindow, validatePunchLocation, type Location } from './attendancePolicy';

export type DayOverride = 'leave' | 'absent' | 'rest';

interface PunchRow {
  employee_id: string;
  punch_date: string;
  check_in: string | null;
  check_out: string | null;
  status_override: DayOverride | null;
  note: string | null;
  source: string;
}

export interface PunchLog {
  checkIn: string;
  checkOut: string;
  statusOverride: DayOverride | null;
  note: string;
  source: string;
}

export interface DayRecordOptions {
  isToday?: boolean;
  settings?: AttendanceSettings | null;
  currentTime?: string;
  /** 已通过出差审批覆盖的日期；出差日状态为“出差”，优先于日历休息日。 */
  travelDates?: Set<string>;
  /** 已通过请假审批覆盖的日期；请假日状态为“请假”，优先于日历休息日、低于出差。 */
  leaveDates?: Set<string>;
}

function mapPunch(row: PunchRow): PunchLog {
  return {
    checkIn: row.check_in || '',
    checkOut: row.check_out || '',
    statusOverride: row.status_override || null,
    note: row.note || '',
    source: row.source || 'employee',
  };
}

export async function getPunch(employeeId: string, day: string): Promise<PunchLog | null> {
  const row = await queryOne<PunchRow>(
    `SELECT employee_id, punch_date, check_in, check_out, status_override, note, source
     FROM attendance_punches WHERE employee_id = ? AND punch_date = ?`,
    [employeeId, day]
  );
  return row ? mapPunch(row) : null;
}

export async function getPunchMap(
  employeeId: string,
  fromDay: string,
  toDay: string
): Promise<Map<string, PunchLog>> {
  const rows = await queryRows<PunchRow>(
    `SELECT employee_id, punch_date, check_in, check_out, status_override, note, source
     FROM attendance_punches
     WHERE employee_id = ? AND punch_date BETWEEN ? AND ?`,
    [employeeId, fromDay, toDay]
  );
  const map = new Map<string, PunchLog>();
  rows.forEach((row) => map.set(String(row.punch_date), mapPunch(row)));
  return map;
}

/** 管理后台用：一次取多名员工在日期范围内的打卡，key = `${employeeId}|${date}` */
export async function getPunchMapForEmployees(
  employeeIds: string[],
  fromDay: string,
  toDay: string
): Promise<Map<string, PunchLog>> {
  if (!employeeIds.length) return new Map();
  const placeholders = employeeIds.map(() => '?').join(',');
  const rows = await queryRows<PunchRow>(
    `SELECT employee_id, punch_date, check_in, check_out, status_override, note, source
     FROM attendance_punches
     WHERE employee_id IN (${placeholders}) AND punch_date BETWEEN ? AND ?`,
    [...employeeIds, fromDay, toDay]
  );
  const map = new Map<string, PunchLog>();
  rows.forEach((row) => map.set(`${row.employee_id}|${row.punch_date}`, mapPunch(row)));
  return map;
}

/**
 * 生成某一天的考勤记录。
 * 数据只来自 attendance_punches：有打卡看打卡，有状态覆盖看覆盖，
 * 缺卡就是缺卡，不再伪造随机历史。
 */
export function buildDayRecord(
  day: string,
  log: PunchLog | null,
  options: DayRecordOptions = {}
): AttendanceRecord {
  const date = parseDateKey(day);
  const override = log ? log.statusOverride : null;
  const base = {
    date: day,
    day: date.getDate(),
    month: date.getMonth() + 1,
    weekdayText: weekdayCn(date),
    note: log && log.note ? log.note : undefined,
    source: log ? log.source : undefined,
    statusOverride: override,
  };

  if (override === 'leave') {
    return {
      ...base,
      checkIn: log ? log.checkIn : '',
      checkOut: log ? log.checkOut : '',
      status: 'leave',
      statusText: '请假',
      duration: '—',
    };
  }
  if (override === 'absent') {
    return {
      ...base,
      checkIn: log ? log.checkIn : '',
      checkOut: log ? log.checkOut : '',
      status: 'absent',
      statusText: '缺卡',
      duration: '—',
    };
  }
  if (override === 'rest') {
    return {
      ...base,
      checkIn: log ? log.checkIn : '',
      checkOut: log ? log.checkOut : '',
      status: 'rest',
      statusText: '休息',
      duration: '—',
    };
  }

  const checkIn = log?.checkIn || '';
  const checkOut = log?.checkOut || '';
  if (options.travelDates?.has(day)) {
    return { ...base, checkIn, checkOut, status: 'travel', statusText: '出差', duration: '—' };
  }
  if (options.settings?.restDates.includes(day)) {
    return { ...base, checkIn, checkOut, status: 'rest', statusText: '休息', duration: '—' };
  }
  if (options.leaveDates?.has(day)) {
    return { ...base, checkIn, checkOut, status: 'leave', statusText: '请假', duration: '—' };
  }
  const pendingToday = !!options.isToday && (!options.settings?.outEndTime || (options.currentTime || formatTime(new Date(), 'HH:mm')) <= options.settings.outEndTime);
  const status = checkIn && checkOut ? 'normal' : checkIn ? 'missing_out' : checkOut || pendingToday ? 'missing_in' : 'absent';
  const statusText = { normal: '正常', missing_in: '未打上班卡', missing_out: '未打下班卡', absent: '缺卡' }[status];
  return { ...base, checkIn, checkOut, status, statusText,
    duration: checkIn && checkOut ? calcDuration(checkIn, checkOut) : '—',
    isLate: !!checkIn && checkIn > '09:30' };
}

/** 将公司日历展开为指定日期范围的休息日集合，并合并到设置中。 */
function settingsForRange(config: EmployeeAttendanceConfig, from: string, to: string): AttendanceSettings | null {
  if (!config.settings) return null;
  const restDates = resolveConfiguredRestDates(config.calendarRule, config.settings.restDates, from, to);
  return { ...config.settings, restDates: Array.from(restDates).sort() };
}

export async function getAttendanceRecord(employeeId: string, day: string): Promise<AttendanceRecord> {
  const [log, config, travelDates, leaveDates] = await Promise.all([
    getPunch(employeeId, day),
    getAttendanceConfigForEmployee(employeeId),
    getTravelDatesForEmployee(employeeId, day, day),
    getLeaveDatesForEmployee(employeeId, day, day),
  ]);
  const settings = settingsForRange(config, day, day);
  return buildDayRecord(day, log, { isToday: day === dateKey(new Date()), settings, travelDates, leaveDates });
}

export async function getTodayAttendance(employeeId: string): Promise<TodayAttendance> {
  const now = new Date();
  const day = dateKey(now);
  const [log, company, config, travelDates, leaveDates] = await Promise.all([
    getPunch(employeeId, day),
    getCompany(),
    getAttendanceConfigForEmployee(employeeId),
    getTravelDatesForEmployee(employeeId, day, day),
    getLeaveDatesForEmployee(employeeId, day, day),
  ]);
  const settings = settingsForRange(config, day, day);
  const hasIn = !!(log && log.checkIn);
  const hasOut = !!(log && log.checkOut);
  const override = log ? log.statusOverride : null;
  const workday = !settings?.restDates.includes(day) && override !== 'rest';
  const record = buildDayRecord(day, log, { isToday: true, settings, travelDates, leaveDates });
  const window = settings ? getPunchWindow(settings, day, formatTime(now, 'HH:mm')) : null;
  const onTravel = travelDates.has(day) && override !== 'leave' && override !== 'rest';
  const onLeave = leaveDates.has(day) && override !== 'leave' && override !== 'rest';

  let nextType: TodayAttendance['nextType'] = 'wait';
  let nextText = onTravel ? '出差期间无需打卡' : !settings || !settings.inEndTime || !settings.outEndTime ? '请先设置打卡规则' : !workday ? '休息日无需打卡' : onLeave ? '请假无需打卡' : override === 'leave' ? '请假无需打卡' : '不在打卡时间段内';
  if (override !== 'leave' && override !== 'rest' && !onTravel && !onLeave && window === 'in' && !hasIn) {
    nextType = 'in';
    nextText = '上班打卡';
  } else if (override !== 'leave' && override !== 'rest' && !onTravel && !onLeave && window === 'out' && !hasOut) {
    nextType = 'out';
    nextText = '下班打卡';
  } else if (override !== 'leave' && override !== 'rest' && !onTravel && !onLeave && window && ((window === 'in' && hasIn) || (window === 'out' && hasOut))) {
    nextType = 'done';
    nextText = window === 'in' ? '上班卡已打' : '下班卡已打';
  }

  return {
    date: formatTime(now, 'YYYY年MM月DD日'),
    weekday: weekdayFullCn(now),
    time: formatTime(now, 'HH:mm:ss'),
    checkIn: log ? log.checkIn : '',
    checkOut: log ? log.checkOut : '',
    status: record.status,
    statusText: record.statusText,
    nextType,
    nextText,
    workday,
    workTime: company.workTime,
    flexible: company.flexible,
    address: company.address,
    inEndTime: settings?.inEndTime || null,
    outEndTime: settings?.outEndTime || null,
  };
}

export async function punch(employeeId: string, type: PunchType, location?: Location): Promise<PunchResult> {
  if (type !== 'in' && type !== 'out') throw badRequest('打卡类型不正确');

  const now = new Date();
  const day = dateKey(now);
  const travelDates = await getTravelDatesForEmployee(employeeId, day, day);
  if (travelDates.has(day)) return { ok: false, message: '出差期间无需打卡' };

  const config = await getAttendanceConfigForEmployee(employeeId);
  const settings = settingsForRange(config, day, day);
  const locationCheck = validatePunchLocation(settings, location);
  if (!locationCheck.ok) return { ok: false, message: locationCheck.message };

  const time = formatTime(now, 'HH:mm');
  if (!settings || !settings.inEndTime || !settings.outEndTime) return { ok: false, message: '管理员尚未设置打卡时间段' };
  if (settings.restDates.includes(day)) return { ok: false, message: '休息日无需打卡' };
  const leaveDates = await getLeaveDatesForEmployee(employeeId, day, day);
  if (leaveDates.has(day)) return { ok: false, message: '请假无需打卡' };
  if (getPunchWindow(settings, day, time) !== type) return { ok: false, message: '不在打卡时间段内' };

  return transaction(async (conn): Promise<PunchResult> => {
    // 先创建或锁住当日行，确保同一卡的并发请求不会互相覆盖。
    await conn.query(
      `INSERT INTO attendance_punches
        (employee_id, punch_date, check_in, check_out, status_override, note, source, updated_by_admin_id, created_at, updated_at)
       VALUES (?, ?, NULL, NULL, NULL, NULL, 'employee', NULL, NOW(), NOW())
       ON DUPLICATE KEY UPDATE employee_id = VALUES(employee_id)`,
      [employeeId, day]
    );
    const [rows] = await conn.query(
      'SELECT check_in, check_out, status_override FROM attendance_punches WHERE employee_id = ? AND punch_date = ? FOR UPDATE',
      [employeeId, day]
    );
    const row = (rows as Array<{ check_in: string | null; check_out: string | null; status_override: DayOverride | null }>)[0];
    if (row.status_override === 'rest') return { ok: false, message: '休息日无需打卡' };
    if (row.status_override === 'leave') return { ok: false, message: '请假无需打卡' };
    if (type === 'in' && row.check_in) return { ok: false, message: '今日已完成上班打卡' };
    if (type === 'out' && row.check_out) return { ok: false, message: '今日已完成下班打卡' };
    const column = type === 'in' ? 'check_in' : 'check_out';
    await conn.query(
      `UPDATE attendance_punches SET ${column} = ?, status_override = NULL, note = NULL,
       source = 'employee', updated_by_admin_id = NULL, updated_at = NOW() WHERE employee_id = ? AND punch_date = ?`,
      [time, employeeId, day]
    );
    return { ok: true, time, message: type === 'in' ? '上班打卡成功' : '下班打卡成功' };
  });
}

export async function getAttendanceRecords(employeeId: string, days = 14): Promise<AttendanceRecord[]> {
  const count = Math.min(Math.max(Math.trunc(days) || 14, 1), 120);
  const now = new Date();
  const todayKey = dateKey(now);
  const startKey = dateKey(new Date(now.getTime() - (count - 1) * 86400000));
  const [punchMap, config, travelDates, leaveDates] = await Promise.all([
    getPunchMap(employeeId, startKey, todayKey),
    getAttendanceConfigForEmployee(employeeId),
    getTravelDatesForEmployee(employeeId, startKey, todayKey),
    getLeaveDatesForEmployee(employeeId, startKey, todayKey),
  ]);
  const settings = settingsForRange(config, startKey, todayKey);

  const list: AttendanceRecord[] = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(now.getTime() - i * 86400000);
    const key = dateKey(d);
    const record = buildDayRecord(key, punchMap.get(key) || null, { isToday: key === todayKey, settings, travelDates, leaveDates });
    record.isToday = record.date === todayKey;
    list.push(record);
  }
  return list;
}

export function summarizeRecords(list: AttendanceRecord[]): AttendanceSummary {
  const s: AttendanceSummary = { normal: 0, missingIn: 0, missingOut: 0, rest: 0, presentDays: 0, late: 0, absent: 0, leave: 0, travel: 0, overtime: 0, workdays: 0 };
  list.forEach((r) => {
    if (r.status === 'rest') { s.rest += 1; return; }
    s.workdays += 1;
    if (r.status === 'travel') {
      // 出差按正常出勤计算，单独统计天数。
      s.travel += 1;
      s.presentDays += 1;
      return;
    }
    if (r.checkIn || r.checkOut) s.presentDays += 1;
    if (r.isLate) s.late += 1;
    if (r.status === 'normal') s.normal += 1;
    else if (r.status === 'missing_in') s.missingIn += 1;
    else if (r.status === 'missing_out') s.missingOut += 1;
    else if (r.status === 'absent') s.absent += 1;
    else if (r.status === 'leave') s.leave += 1;
  });
  return s;
}

export async function getAttendanceStats(employeeId: string): Promise<AttendanceStats> {
  const records = await getAttendanceRecords(employeeId, 31);
  const now = new Date();
  const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay();
  const weekStart = new Date(now.getTime() - (dayOfWeek - 1) * 86400000);
  const weekStartKey = dateKey(weekStart);
  const todayKey = dateKey(now);

  const weekList = records.filter((r) => r.date >= weekStartKey && r.date <= todayKey);
  const monthPrefix = formatTime(now, 'YYYY-MM');
  const monthList = records.filter((r) => r.date.startsWith(monthPrefix));

  const totalMinutes = records.reduce((acc, r) => {
    if (!r.checkIn || !r.checkOut) return acc;
    const [sh, sm] = r.checkIn.split(':').map(Number);
    const [eh, em] = r.checkOut.split(':').map(Number);
    let mins = eh * 60 + em - (sh * 60 + sm);
    if (mins < 0) mins += 1440;
    return acc + mins;
  }, 0);

  return {
    week: summarizeRecords(weekList),
    month: summarizeRecords(monthList),
    avgHours: records.length ? (totalMinutes / 60 / records.length).toFixed(1) : '0.0',
    totalDays: records.filter((r) => r.checkIn || r.checkOut).length,
  };
}
