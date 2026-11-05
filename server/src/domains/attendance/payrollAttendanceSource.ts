import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { badRequest } from '../../shared/utils/errors';
import { buildDayRecord, summarizeRecords, type DayOverride } from './attendanceService';
import type { AttendanceSettings } from './attendanceSettings';
import type { AttendanceMetric } from '../payroll/salaryModelService';

export interface PayrollAttendanceValues { presentDays?: number; overtimeHours?: number }

function groupByEmployee(rows: RowDataPacket[]): Map<string, RowDataPacket[]> {
  const result = new Map<string, RowDataPacket[]>();
  for (const row of rows) {
    const key = String(row.employee_id);
    const group = result.get(key) ?? [];
    group.push(row); result.set(key, group);
  }
  return result;
}

/** 使用工资事务的连接读取批次月份；时长按上班卡日期归属，小时保留两位小数。 */
export async function readPayrollAttendance(conn: PoolConnection, employees: Array<{ id: string; name: string }>, month: string, metrics: Set<AttendanceMetric>): Promise<Map<string, PayrollAttendanceValues>> {
  const result = new Map(employees.map(employee => [employee.id, {} as PayrollAttendanceValues]));
  if (!employees.length || !metrics.size) return result;
  const ids = employees.map(employee => employee.id);
  const placeholders = ids.map(() => '?').join(',');
  const start = `${month}-01`;
  if (metrics.has('presentDays')) {
    const [settingsRows] = await conn.query<RowDataPacket[]>('SELECT rest_dates FROM attendance_settings WHERE id = 1');
    if (!settingsRows.length) throw badRequest('请先配置考勤规则，再获取出勤天数');
    const rawRestDates = settingsRows[0].rest_dates;
    const restDates: string[] = typeof rawRestDates === 'string' ? JSON.parse(rawRestDates) : rawRestDates ?? [];
    const settings = { restDates } as AttendanceSettings;
    const [rows] = await conn.query<RowDataPacket[]>(`SELECT employee_id, DATE_FORMAT(punch_date, '%Y-%m-%d') AS day, check_in, check_out, status_override, note, source FROM attendance_punches WHERE employee_id IN (${placeholders}) AND punch_date >= ? AND punch_date < DATE_ADD(?, INTERVAL 1 MONTH)`, [...ids, start, start]);
    const rowsByEmployee = groupByEmployee(rows);
    for (const employee of employees) {
      const ownRows = rowsByEmployee.get(employee.id) ?? [];
      if (!ownRows.length) throw badRequest(`员工“${employee.name}”在 ${month} 没有考勤记录，请先核实`);
      const records = ownRows.map(row => buildDayRecord(String(row.day), { checkIn: row.check_in || '', checkOut: row.check_out || '', statusOverride: row.status_override as DayOverride | null, note: row.note || '', source: row.source || 'employee' }, { settings }));
      const incomplete = records.find(record => record.status === 'missing_in' || record.status === 'missing_out');
      if (incomplete) throw badRequest(`员工“${employee.name}”${incomplete.date} 考勤打卡不完整，请先处理`);
      result.get(employee.id)!.presentDays = summarizeRecords(records).presentDays;
    }
  }
  if (metrics.has('overtimeHours')) {
    const [rows] = await conn.query<RowDataPacket[]>(`SELECT p.employee_id, p.check_out, TIMESTAMPDIFF(SECOND, p.check_in, p.check_out) AS seconds FROM attendance_overtime_punches p JOIN approvals a ON a.id = p.approval_id WHERE p.employee_id IN (${placeholders}) AND p.check_in >= ? AND p.check_in < DATE_ADD(?, INTERVAL 1 MONTH) AND a.type = 'overtime' AND a.status = 'approved'`, [...ids, start, start]);
    const rowsByEmployee = groupByEmployee(rows);
    for (const employee of employees) {
      const ownRows = rowsByEmployee.get(employee.id) ?? [];
      if (ownRows.some(row => !row.check_out)) throw badRequest(`员工“${employee.name}”在 ${month} 存在未完成的加班打卡，请先处理`);
      if (ownRows.some(row => row.seconds === null || !Number.isFinite(Number(row.seconds)) || Number(row.seconds) < 0)) throw badRequest(`员工“${employee.name}”的加班时长无效`);
      const seconds = ownRows.reduce((sum, row) => sum + Number(row.seconds), 0);
      result.get(employee.id)!.overtimeHours = Math.round(seconds / 3600 * 100) / 100;
    }
  }
  return result;
}
