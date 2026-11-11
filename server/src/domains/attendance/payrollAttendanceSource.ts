import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { badRequest } from '../../shared/utils/errors';
import { buildDayRecord, type DayOverride } from './attendanceService';
import type { AttendanceRecord } from '../../shared/types/models';
import type { AttendanceSettings } from './attendanceSettings';
import type { AttendanceMetric } from '../payroll/salaryModelService';
import { calculateOvertimePay, isPaidOvertime, type OvertimeRuleConfig, type OvertimeRule } from '../payroll/overtimePayrollService';
import { readOvertimeRuleConfig } from '../payroll/overtimeRuleConfigRepository';
import { readAttendanceRuleConfigForPayroll } from '../payroll/attendanceRuleConfigRepository';
import { calculateAttendanceRule } from '../payroll/attendanceRuleCalculation';
import type { AttendanceRuleConfig } from '../payroll/attendanceRuleConfig';

export interface PayrollAttendanceValues { presentDays?: number; overtimeHours?: number; overtimePay?: number; attendanceAdjustment?: number; attendanceCalculation?: { presentDays: number; workdays: number; input: number; periodStart: string; periodEnd: string; config: AttendanceRuleConfig; matchedRule: unknown }; overtimeCalculation?: { seconds: number; config: OvertimeRuleConfig; matchedRule: OvertimeRule | null } }

function parseRestDates(value: unknown): string[] {
  if (!value) return [];
  return (typeof value === 'string' ? JSON.parse(value) : value) as string[];
}

function groupByEmployee(rows: RowDataPacket[]): Map<string, RowDataPacket[]> {
  const result = new Map<string, RowDataPacket[]>();
  for (const row of rows) {
    const key = String(row.employee_id);
    const group = result.get(key) ?? [];
    group.push(row); result.set(key, group);
  }
  return result;
}

/** 工资统计只计完整上下班卡，普通单卡按缺勤处理。 */
function payrollPresentDays(records: AttendanceRecord[]): number {
  return records.filter(record => record.status !== 'rest' && !!record.checkIn && !!record.checkOut).length;
}

/** 使用工资事务的连接读取批次月份；时长按上班卡日期归属，小时保留两位小数。 */
export async function readPayrollAttendance(conn: PoolConnection, employees: Array<{ id: string; name: string }>, month: string, metrics: Set<AttendanceMetric>, options: { attendanceRule?: boolean } = {}): Promise<Map<string, PayrollAttendanceValues>> {
  const result = new Map(employees.map(employee => [employee.id, {} as PayrollAttendanceValues]));
  if (!employees.length || !metrics.size) return result;
  const ids = employees.map(employee => employee.id);
  const placeholders = ids.map(() => '?').join(',');
  const start = `${month}-01`;
  if (metrics.has('presentDays')) {
    const config = options.attendanceRule ? await readAttendanceRuleConfigForPayroll(conn) : undefined;
    const [settingsRows] = await conn.query<RowDataPacket[]>('SELECT rest_dates FROM attendance_settings WHERE id = 1');
    const [groupRows] = await conn.query<RowDataPacket[]>(`SELECT m.employee_id, g.rest_dates FROM attendance_group_employees m JOIN attendance_groups g ON g.id = m.group_id WHERE m.employee_id IN (${placeholders})`, ids);
    const defaultRestDates = settingsRows.length ? parseRestDates(settingsRows[0].rest_dates) : null;
    const groupRestDates = new Map<string, string[]>();
    for (const row of groupRows) groupRestDates.set(String(row.employee_id), parseRestDates(row.rest_dates));
    const [rows] = await conn.query<RowDataPacket[]>(`SELECT employee_id, DATE_FORMAT(punch_date, '%Y-%m-%d') AS day, check_in, check_out, status_override, note, source FROM attendance_punches WHERE employee_id IN (${placeholders}) AND punch_date >= ? AND punch_date < DATE_ADD(?, INTERVAL 1 MONTH)`, [...ids, start, start]);
    const [employment] = config ? await conn.query<RowDataPacket[]>(`SELECT e.id, DATE_FORMAT(e.join_date, '%Y-%m-%d') AS join_date, (SELECT DATE_FORMAT(MAX(d.last_date), '%Y-%m-%d') FROM hr_employee_departures d WHERE d.employee_id = e.id AND d.status = 'departed') AS departure_date FROM employees e WHERE e.id IN (${placeholders})`, ids) : [[]];
    const rowsByEmployee = groupByEmployee(rows);
    for (const employee of employees) {
      const ownRows = rowsByEmployee.get(employee.id) ?? [];
      if (!ownRows.length) throw badRequest(`员工“${employee.name}”在 ${month} 没有考勤记录，请先核实`);
      const restDates = groupRestDates.get(employee.id) ?? defaultRestDates;
      if (!restDates) throw badRequest('请先配置考勤规则，再获取出勤天数');
      const settings = { restDates } as AttendanceSettings;
      const records = ownRows.map(row => buildDayRecord(String(row.day), { checkIn: row.check_in || '', checkOut: row.check_out || '', statusOverride: row.status_override as DayOverride | null, note: row.note || '', source: row.source || 'employee' }, { settings }));
      result.get(employee.id)!.presentDays = payrollPresentDays(records);
      if (config) {
        const dates = employment.find(row => String(row.id) === employee.id);
        if (!dates?.join_date) throw badRequest(`员工“${employee.name}”缺少入职日期`);
        const [year, monthNumber] = month.split('-').map(Number);
        const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
        const last = `${month}-${String(lastDay).padStart(2, '0')}`;
        const periodStart = String(dates.join_date) > start ? String(dates.join_date) : start;
        const periodEnd = dates.departure_date && String(dates.departure_date) < last ? String(dates.departure_date) : last;
        const rest = new Set(restDates);
        let workdays = 0;
        for (let day = 1; day <= lastDay; day++) {
          const key = `${month}-${String(day).padStart(2, '0')}`;
          if (key >= periodStart && key <= periodEnd && !rest.has(key)) workdays++;
        }
        const actual = records.filter(record => record.date >= periodStart && record.date <= periodEnd && !rest.has(record.date));
        const presentDays = payrollPresentDays(actual);
        const calculated = calculateAttendanceRule(config, presentDays, workdays);
        result.get(employee.id)!.attendanceAdjustment = calculated.amount;
        result.get(employee.id)!.attendanceCalculation = { presentDays, workdays, input: calculated.input, periodStart, periodEnd, config, matchedRule: calculated.matchedRule };
      }
    }
  }
  if (metrics.has('overtimeHours') || metrics.has('overtimePay')) {
    const config = metrics.has('overtimePay') ? await readOvertimeRuleConfig(conn) : undefined;
    const [rows] = await conn.query<RowDataPacket[]>(`SELECT p.employee_id, p.check_out, a.form_json, TIMESTAMPDIFF(SECOND, p.check_in, p.check_out) AS seconds FROM attendance_overtime_punches p JOIN approvals a ON a.id = p.approval_id WHERE p.employee_id IN (${placeholders}) AND p.check_in >= ? AND p.check_in < DATE_ADD(?, INTERVAL 1 MONTH) AND a.type = 'overtime' AND a.status = 'approved'`, [...ids, start, start]);
    const rowsByEmployee = groupByEmployee(rows);
    for (const employee of employees) {
      const ownRows = rowsByEmployee.get(employee.id) ?? [];
      const relevant = metrics.has('overtimeHours') ? ownRows : ownRows.filter(row => isPaidOvertime(row.form_json));
      if (relevant.some(row => !row.check_out)) throw badRequest(`员工“${employee.name}”在 ${month} 存在未完成的加班打卡，请先处理`);
      if (relevant.some(row => row.seconds === null || !Number.isFinite(Number(row.seconds)) || Number(row.seconds) < 0)) throw badRequest(`员工“${employee.name}”的加班时长无效`);
      if (metrics.has('overtimeHours')) {
        const seconds = ownRows.reduce((sum, row) => sum + Number(row.seconds), 0);
        result.get(employee.id)!.overtimeHours = Math.round(seconds / 3600 * 100) / 100;
      }
      if (config) {
        const seconds = ownRows.filter(row => isPaidOvertime(row.form_json)).reduce((sum, row) => sum + Number(row.seconds), 0);
        const rules = config.calculation === 'range' ? config.rules : [{ minHours: 0, maxHours: null, hourlyRate: config.hourlyRate }];
        const calculated = calculateOvertimePay(seconds, rules);
        result.get(employee.id)!.overtimePay = calculated.amount;
        result.get(employee.id)!.overtimeCalculation = { seconds, config, matchedRule: calculated.matchedRule };
      }
    }
  }
  return result;
}
