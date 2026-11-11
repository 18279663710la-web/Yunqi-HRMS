import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { buildDayRecord, summarizeRecords, type PunchLog } from '../attendance/attendanceService';
import type { AttendanceSettings } from '../attendance/attendanceSettings';
import { dateKey, parseDateKey } from '../../shared/utils/datetime';
import { badRequest } from '../../shared/utils/errors';
import { calculateEmployeeOvertime, type OvertimeRule } from './overtimePayrollService';

export interface PayrollRule { minRate: number; maxRate: number; adjustment: number }

export async function calculatePayrollAttendance(conn: PoolConnection, employeeId: string, month: string, baseGross: number, deductions: number, rules: PayrollRule[], overtimeRules?: OvertimeRule[]) {
  const [settingsRows] = await conn.query<RowDataPacket[]>('SELECT * FROM attendance_settings WHERE id = 1');
  const row = settingsRows[0];
  const settings: AttendanceSettings | null = row ? {
    startTime: row.start_time, inEndTime: row.in_end_time, endTime: row.end_time, outEndTime: row.out_end_time,
    restDates: typeof row.rest_dates === 'string' ? JSON.parse(row.rest_dates) : (row.rest_dates || []),
    latitude: Number(row.latitude), longitude: Number(row.longitude), radius: Number(row.radius),
  } : null;
  const [employees] = await conn.query<RowDataPacket[]>("SELECT (SELECT MAX(last_date) FROM hr_employee_departures WHERE employee_id = ? AND status = 'departed') AS departure_date", [employeeId]);
  const departure = employees[0]?.departure_date ? String(employees[0].departure_date).slice(0, 10) : null;
  const start = parseDateKey(`${month}-01`);
  const last = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  const today = dateKey(new Date());
  const end = dateKey(last) > today ? today : dateKey(last);
  const [punchRows] = await conn.query<RowDataPacket[]>('SELECT punch_date, check_in, check_out, status_override, note, source FROM attendance_punches WHERE employee_id = ? AND punch_date BETWEEN ? AND ?', [employeeId, `${month}-01`, end]);
  const punches = new Map<string, PunchLog>(punchRows.map(p => [String(p.punch_date).slice(0, 10), { checkIn: p.check_in || '', checkOut: p.check_out || '', statusOverride: p.status_override || null, note: p.note || '', source: p.source || 'employee' }]));
  const records = [];
  for (const cursor = new Date(start); dateKey(cursor) <= end; cursor.setDate(cursor.getDate() + 1)) {
    const day = dateKey(cursor);
    if (departure && day > departure) continue;
    records.push(buildDayRecord(day, punches.get(day) || null, { isToday: day === today, settings }));
  }
  const summary = summarizeRecords(records);
  const rate = summary.workdays ? Math.round(summary.normal * 10000 / summary.workdays) / 100 : null;
  const matchedRule = rate === null ? undefined : rules.find(rule => rule.minRate === 100 && rule.maxRate === 100 ? rate === 100 : rate >= rule.minRate && rate < rule.maxRate);
  const adjustment = matchedRule?.adjustment || 0;
  const overtime = await calculateEmployeeOvertime(conn, employeeId, month, overtimeRules);
  const grossCents = Math.round(Number(baseGross) * 100) + Math.round(adjustment * 100) + Math.round(overtime.amount * 100);
  const deductionCents = Math.round(Number(deductions) * 100);
  if (grossCents < 0 || grossCents > 999999999999 || deductionCents > grossCents) throw badRequest(`员工 ${employeeId} 在 ${month} 的工资调整后金额无效，请检查规则和工资明细`);
  return { baseGross: Number(baseGross), rate, adjustment, overtime, gross: grossCents / 100, net: (grossCents - deductionCents) / 100,
    snapshot: { normal: summary.normal, workdays: summary.workdays, rate, matchedRule: matchedRule || null, rules } };
}
