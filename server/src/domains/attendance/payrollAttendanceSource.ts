import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { badRequest } from '../../shared/utils/errors';
import { buildDayRecord, type DayOverride } from './attendanceService';
import type { AttendanceRecord } from '../../shared/types/models';
import type { AttendanceSettings } from './attendanceSettings';
import {
  mapCompanyCalendarRuleRow,
  resolveConfiguredRestDates,
  type CalendarRuleRow,
  type CompanyCalendarRule,
} from './companyCalendar';
import { getTravelDateMapForEmployees } from './travelAttendanceService';
import { getLeaveDateMapForEmployees } from './leaveAttendanceService';
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

/** 工资统计只计完整上下班卡，普通单卡按缺勤处理；已通过的出差日按正常出勤计算。 */
function payrollPresentDays(records: AttendanceRecord[], travelDates: Set<string>): number {
  const completeDays = records.filter(record => record.status !== 'rest' && record.status !== 'travel' && !!record.checkIn && !!record.checkOut).length;
  // 出差日无打卡也计入出勤；出差日与打卡重叠时仅按出差计一次。
  return completeDays + travelDates.size;
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
    const [firstGroupRows] = await conn.query<RowDataPacket[]>('SELECT calendar_rule_id, rest_dates FROM attendance_groups ORDER BY id ASC LIMIT 1');
    const [groupRows] = await conn.query<RowDataPacket[]>(`SELECT m.employee_id, g.calendar_rule_id, g.rest_dates FROM attendance_group_employees m JOIN attendance_groups g ON g.id = m.group_id WHERE m.employee_id IN (${placeholders})`, ids);
    const [ruleRows] = await conn.query<RowDataPacket[]>('SELECT * FROM company_calendar_rules ORDER BY id ASC');
    const rules = (ruleRows as unknown as CalendarRuleRow[]).map(mapCompanyCalendarRuleRow);
    const ruleMap = new Map(rules.map((rule) => [rule.id, rule]));
    const firstRule = rules[0] ?? null;
    const hasGroups = firstGroupRows.length > 0;
    // 无考勤组时沿用初始考勤设置；有组时未分配员工使用第一个组的日历。
    const fallbackRule = hasGroups
      ? (firstGroupRows[0].calendar_rule_id ? ruleMap.get(Number(firstGroupRows[0].calendar_rule_id)) ?? firstRule : firstRule)
      : null;
    const fallbackLegacyRestDates = hasGroups
      ? parseRestDates(firstGroupRows[0].rest_dates)
      : settingsRows.length ? parseRestDates(settingsRows[0].rest_dates) : null;
    const groupConfigs = new Map<string, { rule: CompanyCalendarRule | null; legacyRestDates: string[] }>();
    for (const row of groupRows) {
      const ruleId = row.calendar_rule_id ? Number(row.calendar_rule_id) : null;
      groupConfigs.set(String(row.employee_id), {
        rule: ruleId ? ruleMap.get(ruleId) ?? fallbackRule : fallbackRule,
        legacyRestDates: parseRestDates(row.rest_dates),
      });
    }
    const [year, monthNumber] = month.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const last = `${month}-${String(lastDay).padStart(2, '0')}`;
    const [rows] = await conn.query<RowDataPacket[]>(`SELECT employee_id, DATE_FORMAT(punch_date, '%Y-%m-%d') AS day, check_in, check_out, status_override, note, source FROM attendance_punches WHERE employee_id IN (${placeholders}) AND punch_date >= ? AND punch_date < DATE_ADD(?, INTERVAL 1 MONTH)`, [...ids, start, start]);
    const travelMap = await getTravelDateMapForEmployees(ids, start, last, conn);
    const leaveMap = await getLeaveDateMapForEmployees(ids, start, last, conn);
    const [employment] = config ? await conn.query<RowDataPacket[]>(`SELECT e.id, DATE_FORMAT(e.join_date, '%Y-%m-%d') AS join_date, (SELECT DATE_FORMAT(MAX(d.last_date), '%Y-%m-%d') FROM hr_employee_departures d WHERE d.employee_id = e.id AND d.status = 'departed') AS departure_date FROM employees e WHERE e.id IN (${placeholders})`, ids) : [[]];
    const rowsByEmployee = groupByEmployee(rows);
    for (const employee of employees) {
      const ownRows = rowsByEmployee.get(employee.id) ?? [];
      if (!ownRows.length) throw badRequest(`员工“${employee.name}”在 ${month} 没有考勤记录，请先核实`);
      const groupConfig = groupConfigs.get(employee.id);
      const rule = groupConfig ? groupConfig.rule : fallbackRule;
      const legacyRestDates = groupConfig ? groupConfig.legacyRestDates : fallbackLegacyRestDates;
      if (!rule && legacyRestDates === null) throw badRequest('请先配置公司日历，再获取出勤天数');
      const restDates = Array.from(resolveConfiguredRestDates(rule, legacyRestDates ?? [], start, last)).sort();
      const settings = { restDates } as AttendanceSettings;
      const travelDates = travelMap.get(employee.id) ?? new Set<string>();
      const leaveDates = leaveMap.get(employee.id) ?? new Set<string>();
      const records = ownRows.map(row => buildDayRecord(String(row.day), { checkIn: row.check_in || '', checkOut: row.check_out || '', statusOverride: row.status_override as DayOverride | null, note: row.note || '', source: row.source || 'employee' }, { settings, travelDates, leaveDates }));
      result.get(employee.id)!.presentDays = payrollPresentDays(records, travelDates);
      if (config) {
        const dates = employment.find(row => String(row.id) === employee.id);
        if (!dates?.join_date) throw badRequest(`员工“${employee.name}”缺少入职日期`);
        const periodStart = String(dates.join_date) > start ? String(dates.join_date) : start;
        const periodEnd = dates.departure_date && String(dates.departure_date) < last ? String(dates.departure_date) : last;
        const rest = new Set(restDates);
        let workdays = 0;
        for (let day = 1; day <= lastDay; day++) {
          const key = `${month}-${String(day).padStart(2, '0')}`;
          // 出差日优先于日历休息日：出差落在日历休息日时计入应出勤，保证 presentDays <= workdays。
          if (key >= periodStart && key <= periodEnd && (!rest.has(key) || travelDates.has(key))) workdays++;
        }
        const actual = records.filter(record => record.date >= periodStart && record.date <= periodEnd && !rest.has(record.date));
        const actualTravel = new Set(Array.from(travelDates).filter(date => date >= periodStart && date <= periodEnd));
        const presentDays = payrollPresentDays(actual, actualTravel);
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
