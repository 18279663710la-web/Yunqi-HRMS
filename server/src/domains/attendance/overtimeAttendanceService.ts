import type { RowDataPacket } from 'mysql2';
import { queryRows, transaction } from '../../shared/db/pool';
import { formatTime } from '../../shared/utils/datetime';
import { getAttendanceSettingsForEmployee } from './attendanceGroups';
import { validatePunchLocation, type Location } from './attendancePolicy';

interface FormField { label: string; value: string }
function startOf(formValue: unknown): string | null {
  let form: unknown = formValue;
  if (typeof form === 'string') { try { form = JSON.parse(form); } catch { return null; } }
  if (!Array.isArray(form)) return null;
  const field = (label: string) => (form as FormField[]).filter(item => item?.label === label).map(item => item.value);
  const date = field('加班日期'); const time = field('开始时间');
  if (date.length !== 1 || time.length !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(date[0]) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time[0])) return null;
  const parsed = new Date(`${date[0]}T${time[0]}:00`);
  return !Number.isNaN(parsed.getTime()) && formatTime(parsed, 'YYYY-MM-DD HH:mm') === `${date[0]} ${time[0]}` ? `${date[0]} ${time[0]}` : null;
}

export async function listOvertimePunches(employeeId: string) {
  const rows = await queryRows<{ id: string; form_json: unknown; checkIn: string | null; checkOut: string | null }>(`SELECT a.id, a.form_json, p.check_in AS checkIn, p.check_out AS checkOut FROM approvals a LEFT JOIN attendance_overtime_punches p ON p.approval_id = a.id WHERE a.type = 'overtime' AND a.status = 'approved' AND a.applicant_id = ? AND (p.check_out IS NULL) ORDER BY a.created_at DESC`, [employeeId]);
  const now = formatTime(new Date(), 'YYYY-MM-DD HH:mm');
  const active = rows.some(row => !!row.checkIn);
  return rows.flatMap(row => { const start = startOf(row.form_json); return start ? [{ approvalId: row.id, start, checkIn: row.checkIn, canPunch: !!row.checkIn || (!active && now >= start), nextType: row.checkIn ? 'out' : 'in' }] : []; });
}

export async function punchOvertime(employeeId: string, approvalId: string, type: 'in' | 'out', location?: Location) {
  const locationCheck = validatePunchLocation(await getAttendanceSettingsForEmployee(employeeId), location);
  if (!locationCheck.ok) return { ok: false, message: locationCheck.message };
  const now = formatTime(new Date(), 'YYYY-MM-DD HH:mm:ss');
  return transaction(async conn => {
    await conn.query('SELECT id FROM employees WHERE id = ? FOR UPDATE', [employeeId]);
    const [approvals] = await conn.query<RowDataPacket[]>("SELECT form_json FROM approvals WHERE id = ? AND applicant_id = ? AND type = 'overtime' AND status = 'approved' FOR UPDATE", [approvalId, employeeId]);
    if (!approvals.length) return { ok: false, message: '加班申请不存在或未通过审批' };
    const start = startOf(approvals[0].form_json);
    if (!start) return { ok: false, message: '加班申请时间无效' };
    const [rows] = await conn.query<RowDataPacket[]>('SELECT check_in, check_out FROM attendance_overtime_punches WHERE approval_id = ? FOR UPDATE', [approvalId]);
    if (type === 'in') {
      if (rows.length) return { ok: false, message: '已完成加班上班打卡' };
      if (now.slice(0, 16) < start) return { ok: false, message: '尚未到申请的加班开始时间' };
      const [active] = await conn.query<RowDataPacket[]>('SELECT approval_id FROM attendance_overtime_punches WHERE employee_id = ? AND check_out IS NULL LIMIT 1', [employeeId]);
      if (active.length) return { ok: false, message: '请先完成当前加班下班打卡' };
      await conn.execute('INSERT INTO attendance_overtime_punches (approval_id, employee_id, check_in) VALUES (?, ?, ?)', [approvalId, employeeId, now]);
    } else {
      if (!rows.length) return { ok: false, message: '请先打加班上班卡' };
      if (rows[0].check_out) return { ok: false, message: '已完成加班下班打卡' };
      if (now < String(rows[0].check_in)) return { ok: false, message: '打卡时间异常' };
      await conn.execute('UPDATE attendance_overtime_punches SET check_out = ? WHERE approval_id = ?', [now, approvalId]);
    }
    return { ok: true, time: now, message: type === 'in' ? '加班上班打卡成功' : '加班下班打卡成功' };
  });
}

export async function getOvertimeMapForEmployees(employeeIds: string[], start: string, end: string) {
  const result = new Map<string, { overtimeMinutes: number; overtimeSeconds: number; overtimeCount: number; overtimePeriods: { checkIn: string; checkOut: string | null }[] }>();
  if (!employeeIds.length) return result;
  const placeholders = employeeIds.map(() => '?').join(',');
  const rows = await queryRows<{ employee_id: string; check_in: string; check_out: string | null; seconds: number | null }>(`SELECT employee_id, check_in, check_out, TIMESTAMPDIFF(SECOND, check_in, check_out) AS seconds FROM attendance_overtime_punches WHERE employee_id IN (${placeholders}) AND check_in >= ? AND check_in < DATE_ADD(?, INTERVAL 1 DAY) ORDER BY check_in`, [...employeeIds, start, end]);
  for (const row of rows) {
    const key = `${row.employee_id}|${String(row.check_in).slice(0, 10)}`;
    const item = result.get(key) || { overtimeMinutes: 0, overtimeSeconds: 0, overtimeCount: 0, overtimePeriods: [] };
    item.overtimeSeconds += Math.max(0, Number(row.seconds || 0));
    item.overtimeMinutes = Math.floor(item.overtimeSeconds / 60);
    item.overtimeCount += 1;
    item.overtimePeriods.push({ checkIn: row.check_in, checkOut: row.check_out });
    result.set(key, item);
  }
  return result;
}
