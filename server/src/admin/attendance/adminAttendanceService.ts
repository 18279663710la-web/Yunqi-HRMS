import { execute, queryOne, queryRows } from '../../shared/db/pool';
import type {
  AdminAttendanceEmployeeSummary,
  AdminAttendanceRecord,
  AdminAttendanceResponse,
  AdminDashboard,
  AdminUser,
  JobCategoryName,
} from '../../shared/types/admin';
import type { AttendanceRecord, AttendanceSummary } from '../../shared/types/models';
import { dateKey, parseDateKey, toMinuteText } from '../../shared/utils/datetime';
import { badRequest, notFound } from '../../shared/utils/errors';
import { getPunch, getPunchMapForEmployees, buildDayRecord, summarizeRecords } from '../../domains/attendance/attendanceService';
import { recordAdminLog } from '../../domains/audit/adminLogService';
import {
  getAttendanceConfigForEmployee,
  getAttendanceConfigMap,
  type EmployeeAttendanceConfig,
} from '../../domains/attendance/attendanceGroups';
import { resolveConfiguredRestDates } from '../../domains/attendance/companyCalendar';
import { getTravelDateMapForEmployees, getTravelDatesForEmployee } from '../../domains/attendance/travelAttendanceService';
import { getOvertimeMapForEmployees } from '../../domains/attendance/overtimeAttendanceService';
import { listJobTitles } from '../../domains/employees/jobTitleService';

interface AdminEmployeeRow {
  id: string;
  name: string;
  employee_no: string;
  pinyin: string;
  dept_id: string;
  dept_name: string | null;
  position: string;
  join_date: string;
  login_name: string | null;
  account_status: string | null;
  departure_date: string | null;
}

const EMPLOYEE_SELECT = `
  SELECT e.id, e.name, e.employee_no, e.pinyin, e.dept_id, e.position, e.join_date,
         d.name AS dept_name, a.login_name, a.status AS account_status,
         (SELECT MAX(hd.last_date) FROM hr_employee_departures hd WHERE hd.employee_id = e.id AND hd.status = 'departed') AS departure_date
  FROM employees e
  LEFT JOIN departments d ON d.id = e.dept_id
  LEFT JOIN employee_accounts a ON a.employee_id = e.id
`;

async function collectDeptIds(deptId: string): Promise<string[]> {
  const rows = await queryRows<{ id: string; parent_id: string | null }>(
    'SELECT id, parent_id FROM departments'
  );
  const ids = new Set<string>([deptId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (row.parent_id && ids.has(row.parent_id) && !ids.has(row.id)) {
        ids.add(row.id);
        changed = true;
      }
    }
  }
  return Array.from(ids);
}

async function queryEmployees(
  deptId?: string,
  jobCategory?: JobCategoryName,
  employeeId?: string
): Promise<AdminEmployeeRow[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (employeeId) {
    where.push('e.id = ?');
    args.push(employeeId);
  }
  if (deptId) {
    const ids = await collectDeptIds(deptId);
    where.push(`e.dept_id IN (${ids.map(() => '?').join(',')})`);
    args.push(...ids);
  }
  if (jobCategory) {
    where.push('e.position = ?');
    args.push(jobCategory);
  }
  return queryRows<AdminEmployeeRow>(
    `${EMPLOYEE_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY e.pinyin ASC`,
    args
  );
}

function monthRange(month?: string): { month: string; startDate: string; endDate: string } {
  const now = new Date();
  let year = now.getFullYear();
  let monthIndex = now.getMonth();
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    year = Number(month.slice(0, 4));
    monthIndex = Number(month.slice(5, 7)) - 1;
  }
  const monthKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  const first = new Date(year, monthIndex, 1);
  const last = new Date(year, monthIndex + 1, 0);
  const today = new Date();
  const end = last.getTime() > today.getTime() ? today : last;
  return {
    month: monthKey,
    startDate: dateKey(first),
    endDate: dateKey(end),
  };
}

function iterateDays(startDate: string, endDate: string): string[] {
  const days: string[] = [];
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate);
  const cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    days.push(dateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function minutesOf(record: AttendanceRecord): number {
  if (!record.checkIn || !record.checkOut) return 0;
  const [sh, sm] = record.checkIn.split(':').map(Number);
  const [eh, em] = record.checkOut.split(':').map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins < 0) mins += 1440;
  return mins;
}

function emptySummary(): AttendanceSummary {
  return { normal: 0, missingIn: 0, missingOut: 0, rest: 0, presentDays: 0, late: 0, absent: 0, leave: 0, travel: 0, overtime: 0, workdays: 0 };
}

/** 按公司日历展开某员工在日期范围内的休息日。 */
function settingsForConfig(config: EmployeeAttendanceConfig | undefined, from: string, to: string) {
  if (!config?.settings) return null;
  const restDates = resolveConfiguredRestDates(config.calendarRule, config.settings.restDates, from, to);
  return { ...config.settings, restDates: Array.from(restDates).sort() };
}

const emptyTravelDates: Set<string> = new Set();

export interface AdminAttendanceParams {
  month?: string;
  date?: string;
  deptId?: string;
  jobCategory?: JobCategoryName;
  employeeId?: string;
  status?: string;
}

export async function getAdminAttendance(params: AdminAttendanceParams = {}): Promise<AdminAttendanceResponse> {
  let { month, startDate, endDate } = monthRange(params.month);
  if (params.date) {
    const date = parseDateKey(params.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date) || Number.isNaN(date.getTime()) || dateKey(date) !== params.date) {
      throw badRequest('日期格式不正确');
    }
    if (params.date > dateKey(new Date())) throw badRequest('不能查询未来日期的考勤');
    month = params.date.slice(0, 7);
    startDate = params.date;
    endDate = params.date;
  }
  const employees = await queryEmployees(params.deptId, params.jobCategory, params.employeeId);
  if (!employees.length) {
    return { month, startDate, endDate, list: [], summary: emptySummary(), employeeSummary: [] };
  }

  const days = iterateDays(startDate, endDate);
  const employeeIds = employees.map((e) => e.id);
  const [punchMap, configMap, travelMap, overtimeMap] = await Promise.all([
    getPunchMapForEmployees(employeeIds, startDate, endDate),
    getAttendanceConfigMap(employeeIds),
    getTravelDateMapForEmployees(employeeIds, startDate, endDate),
    getOvertimeMapForEmployees(employeeIds, startDate, endDate),
  ]);
  const todayKey = dateKey(new Date());

  const allRows: AdminAttendanceRecord[] = [];
  const byEmployee = new Map<string, AttendanceRecord[]>();

  for (const employee of employees) {
    const employeeRecords: AttendanceRecord[] = [];
    const settings = settingsForConfig(configMap.get(employee.id), startDate, endDate);
    const travelDates = travelMap.get(employee.id) ?? emptyTravelDates;
    for (const day of days) {
      if (employee.departure_date && day > String(employee.departure_date).slice(0, 10)) continue;
      const log = punchMap.get(`${employee.id}|${day}`) || null;
      const record = buildDayRecord(day, log, { isToday: day === todayKey, settings, travelDates });
      employeeRecords.push(record);
      allRows.push({
        ...record,
        ...(overtimeMap.get(`${employee.id}|${day}`) || { overtimeMinutes: 0, overtimeSeconds: 0, overtimeCount: 0, overtimePeriods: [] }),
        employeeId: employee.id,
        employeeName: employee.name,
        employeeNo: employee.employee_no,
        deptId: employee.dept_id,
        deptName: employee.dept_name || '',
        jobCategory: employee.position,
        position: employee.position,
      });
    }
    byEmployee.set(employee.id, employeeRecords);
  }

  const status = params.status && params.status !== 'all' ? params.status : '';
  const list = status ? allRows.filter((r) => status === 'overtime' ? (r.overtimeCount || 0) > 0 : r.status === status) : allRows;
  list.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return a.employeeName.localeCompare(b.employeeName);
  });

  const employeeSummary: AdminAttendanceEmployeeSummary[] = employees.filter((employee) => (byEmployee.get(employee.id) || []).length > 0).map((employee) => {
    const records = byEmployee.get(employee.id) || [];
    const summary = summarizeRecords(records);
    const totalMinutes = records.reduce((acc, r) => acc + minutesOf(r), 0);
    const overtimeRows = records.map(record => overtimeMap.get(`${employee.id}|${record.date}`)).filter((item): item is NonNullable<typeof item> => !!item);
    return {
      ...summary,
      overtime: overtimeRows.length,
      overtimeSeconds: overtimeRows.reduce((sum, row) => sum + (row.overtimeSeconds || 0), 0),
      employeeId: employee.id,
      employeeName: employee.name,
      employeeNo: employee.employee_no,
      deptName: employee.dept_name || '',
      jobCategory: employee.position,
      presentDays: summary.presentDays,
      totalHours: Math.round((totalMinutes / 60) * 10) / 10,
    };
  });
  employeeSummary.sort((a, b) => a.employeeName.localeCompare(b.employeeName));

  return {
    month,
    startDate,
    endDate,
    list,
    summary: { ...summarizeRecords(list), overtime: list.filter(row => (row.overtimeCount || 0) > 0).length },
    employeeSummary,
  };
}

export interface ManualPunchInput {
  employeeId: string;
  date: string;
  checkIn?: string | null;
  checkOut?: string | null;
  statusOverride?: 'leave' | 'absent' | 'rest' | null;
  note?: string;
}

export async function updateAttendancePunch(
  input: ManualPunchInput,
  operator: AdminUser
): Promise<AdminAttendanceRecord> {
  const employee = await queryOne<AdminEmployeeRow>(
    `${EMPLOYEE_SELECT} WHERE e.id = ?`,
    [input.employeeId]
  );
  if (!employee) throw notFound('员工不存在');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw badRequest('日期格式不正确');
  if (employee.departure_date && input.date > String(employee.departure_date).slice(0, 10)) throw badRequest('不能修改离职日期之后的考勤');

  const day = parseDateKey(input.date);
  if (Number.isNaN(day.getTime())) throw badRequest('日期格式不正确');
  if (input.date > dateKey(new Date())) throw badRequest('不能修改未来日期的考勤');

  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
  const checkIn = input.checkIn ? input.checkIn.trim() : '';
  const checkOut = input.checkOut ? input.checkOut.trim() : '';
  if (checkIn && !timePattern.test(checkIn)) throw badRequest('上班时间格式应为 HH:mm');
  if (checkOut && !timePattern.test(checkOut)) throw badRequest('下班时间格式应为 HH:mm');
  if (input.statusOverride && (checkIn || checkOut)) {
    throw badRequest('已填写打卡时间时不能同时设置请假/缺卡/休息');
  }

  const hasTimes = !!checkIn || !!checkOut;
  const statusOverride = input.statusOverride || null;
  const note = String(input.note || '').slice(0, 200);

  if (!hasTimes && !statusOverride) {
    await execute('DELETE FROM attendance_punches WHERE employee_id = ? AND punch_date = ?', [
      input.employeeId,
      input.date,
    ]);
  } else {
    await execute(
      `INSERT INTO attendance_punches
        (employee_id, punch_date, check_in, check_out, status_override, note, source, updated_by_admin_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'admin', ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         check_in = VALUES(check_in), check_out = VALUES(check_out),
         status_override = VALUES(status_override), note = VALUES(note),
         source = 'admin', updated_by_admin_id = VALUES(updated_by_admin_id), updated_at = NOW()`,
      [input.employeeId, input.date, checkIn || null, checkOut || null, statusOverride, note || null, operator.id]
    );
  }

  await recordAdminLog(operator, '修改考勤', 'attendance', `${input.employeeId}|${input.date}`, {
    employeeId: input.employeeId,
    employeeName: employee.name,
    date: input.date,
    checkIn: checkIn || null,
    checkOut: checkOut || null,
    statusOverride,
    note,
  });

  const log = await getPunch(input.employeeId, input.date);
  const config = await getAttendanceConfigForEmployee(input.employeeId);
  const settings = settingsForConfig(config, input.date, input.date);
  const travelDates = await getTravelDatesForEmployee(input.employeeId, input.date, input.date);
  const record = buildDayRecord(input.date, log, { isToday: input.date === dateKey(new Date()), settings, travelDates });
  return {
    ...record,
    employeeId: employee.id,
    employeeName: employee.name,
    employeeNo: employee.employee_no,
    deptId: employee.dept_id,
    deptName: employee.dept_name || '',
    jobCategory: employee.position,
    position: employee.position,
  };
}

export async function getAdminDashboard(): Promise<AdminDashboard> {
  const [employeeCountRow, activeAccountRow, deptCountRow, pendingRow] = await Promise.all([
    queryOne<{ total: number }>("SELECT COUNT(*) AS total FROM employees e WHERE NOT EXISTS (SELECT 1 FROM hr_employee_departures hd WHERE hd.employee_id = e.id AND hd.status = 'departed')"),
    queryOne<{ total: number }>("SELECT COUNT(*) AS total FROM employee_accounts a WHERE a.status = 'active' AND NOT EXISTS (SELECT 1 FROM hr_employee_departures hd WHERE hd.employee_id = a.employee_id AND hd.status = 'departed')"),
    queryOne<{ total: number }>('SELECT COUNT(*) AS total FROM departments'),
    queryOne<{ total: number }>("SELECT COUNT(*) AS total FROM approvals WHERE status = 'pending'"),
  ]);

  const today = dateKey(new Date());
  const employees = await queryRows<AdminEmployeeRow>(`${EMPLOYEE_SELECT} WHERE NOT EXISTS (SELECT 1 FROM hr_employee_departures hd WHERE hd.employee_id = e.id AND hd.status = 'departed') ORDER BY e.pinyin`);
  const [punchMap, configMap, travelMap] = await Promise.all([
    getPunchMapForEmployees(employees.map((e) => e.id), today, today),
    getAttendanceConfigMap(employees.map((e) => e.id)),
    getTravelDateMapForEmployees(employees.map((e) => e.id), today, today),
  ]);

  const todayStats = { total: employees.length, checkedIn: 0, late: 0, notChecked: 0, rest: 0, overtime: 0, onLeave: 0, onTravel: 0 };
  employees.forEach((employee) => {
    const settings = settingsForConfig(configMap.get(employee.id), today, today);
    const record = buildDayRecord(today, punchMap.get(`${employee.id}|${today}`) || null, { isToday: true, settings, travelDates: travelMap.get(employee.id) ?? emptyTravelDates });
    if (record.status === 'rest') todayStats.rest += 1;
    if (record.status === 'leave') todayStats.onLeave += 1;
    if (record.status === 'travel') todayStats.onTravel += 1;
    if (record.checkIn || record.checkOut) {
      todayStats.checkedIn += 1;
      if (record.isLate) todayStats.late += 1;
    }
  });
  todayStats.notChecked = Math.max(0, todayStats.total - todayStats.checkedIn - todayStats.rest - todayStats.onLeave - todayStats.onTravel);

  const jobCategoryCounts = await listJobTitles();

  const recentRows = await queryRows<AdminEmployeeRow>(
    `${EMPLOYEE_SELECT} WHERE NOT EXISTS (SELECT 1 FROM hr_employee_departures hd WHERE hd.employee_id = e.id AND hd.status = 'departed') ORDER BY e.join_date DESC, e.id DESC LIMIT 5`
  );
  const recentEmployees: AdminDashboard['recentEmployees'] = recentRows.map((row) => ({
    id: row.id,
    name: row.name,
    deptName: row.dept_name || '',
    position: row.position,
    joinDate: row.join_date,
    accountStatus: row.account_status === 'active' || row.account_status === 'disabled' ? row.account_status : 'none',
  }));

  const noticeRows = await queryRows<{
    id: string;
    title: string;
    category_name: string;
    publisher: string;
    publish_time: string;
    summary: string;
    is_top: number;
    read_count: number;
    total_count: number;
  }>(
    `SELECT id, title, category_name, publisher, publish_time, summary, is_top, read_count, total_count
     FROM notices ORDER BY is_top DESC, publish_time DESC LIMIT 5`
  );

  return {
    employeeCount: Number(employeeCountRow?.total || 0),
    activeAccountCount: Number(activeAccountRow?.total || 0),
    departmentCount: Number(deptCountRow?.total || 0),
    pendingApprovalCount: Number(pendingRow?.total || 0),
    jobCategoryCounts,
    today: todayStats,
    recentEmployees,
    recentNotices: noticeRows.map((row) => ({
      id: row.id,
      title: row.title,
      categoryName: row.category_name,
      publisher: row.publisher,
      publishTime: toMinuteText(row.publish_time),
      summary: row.summary,
      isTop: !!row.is_top,
      readCount: Number(row.read_count) || 0,
      totalCount: Number(row.total_count) || 0,
    })),
  };
}

