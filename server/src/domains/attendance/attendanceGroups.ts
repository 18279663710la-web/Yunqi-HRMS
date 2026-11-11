import type { PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { z } from 'zod';

import { queryOne, queryRows, transaction } from '../../shared/db/pool';
import type { AdminUser } from '../../shared/types/admin';
import { badRequest, conflict, notFound } from '../../shared/utils/errors';
import { recordAdminLog } from '../audit/adminLogService';
import { attendanceSettingsSchema } from './attendancePolicy';
import {
  getCompanyCalendarRule,
  getCompanyCalendarRulesByIds,
  getDefaultCompanyCalendarRule,
  type CompanyCalendarRule,
} from './companyCalendar';
import {
  getAttendanceSettings,
  mapAttendanceSettingsRow,
  type AttendanceSettings,
  type AttendanceSettingsInput,
  type AttendanceSettingsRow,
} from './attendanceSettings';

export const attendanceGroupMetaSchema = z.object({
  name: z.string().trim().min(1, '考勤组名称不能为空').max(50, '考勤组名称不能超过 50 个字符'),
  calendarRuleId: z.number().int().positive('请选择公司日历'),
  employeeIds: z.array(z.string().min(1).max(10)).max(1000, '单个考勤组最多选择 1000 名员工'),
});

export type AttendanceGroupMeta = z.infer<typeof attendanceGroupMetaSchema>;
export type AttendanceGroupInput = AttendanceSettingsInput & AttendanceGroupMeta;

export interface AttendanceGroup extends AttendanceSettings {
  id: number;
  name: string;
  calendarRuleId: number | null;
  calendarRuleName: string;
  employeeIds: string[];
  employeeCount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface AttendanceGroupsResult {
  groups: AttendanceGroup[];
  /** 无考勤组时生效的初始考勤设置，供新建组预填。 */
  initialSettings: AttendanceSettings | null;
}

export interface EmployeeAttendanceConfig {
  settings: AttendanceSettings | null;
  calendarRule: CompanyCalendarRule | null;
}

interface GroupRow extends AttendanceSettingsRow {
  id: number;
  name: string;
  calendar_rule_id: number | null;
  calendar_rule_name: string | null;
  created_at: string;
  updated_at: string;
}

function mapGroup(row: GroupRow, employeeIds: string[]): AttendanceGroup {
  return {
    id: Number(row.id),
    name: row.name,
    calendarRuleId: row.calendar_rule_id ? Number(row.calendar_rule_id) : null,
    calendarRuleName: row.calendar_rule_name || '',
    ...mapAttendanceSettingsRow(row),
    employeeIds,
    employeeCount: employeeIds.length,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const GROUP_SELECT = `SELECT g.*, r.name AS calendar_rule_name
  FROM attendance_groups g
  LEFT JOIN company_calendar_rules r ON r.id = g.calendar_rule_id`;

async function getGroupById(id: number): Promise<AttendanceGroup | null> {
  const row = await queryOne<GroupRow>(`${GROUP_SELECT} WHERE g.id = ?`, [id]);
  if (!row) return null;
  const members = await queryRows<{ employee_id: string }>(
    'SELECT employee_id FROM attendance_group_employees WHERE group_id = ? ORDER BY employee_id ASC',
    [id]
  );
  return mapGroup(row, members.map((member) => member.employee_id));
}

async function assertNameAvailable(name: string, excludeId?: number): Promise<void> {
  const row = await queryOne<{ id: number }>(
    'SELECT id FROM attendance_groups WHERE name = ? AND id <> ? LIMIT 1',
    [name, excludeId ?? 0]
  );
  if (row) throw conflict('考勤组名称已存在');
}

async function assertCalendarRule(id: number): Promise<void> {
  const rule = await getCompanyCalendarRule(id);
  if (!rule) throw badRequest('请选择有效的公司日历');
}

async function validateEmployeeIds(employeeIds: string[]): Promise<string[]> {
  const unique = Array.from(new Set(employeeIds));
  if (!unique.length) return unique;
  const placeholders = unique.map(() => '?').join(',');
  const rows = await queryRows<{ id: string }>(
    `SELECT id FROM employees WHERE id IN (${placeholders})`,
    unique
  );
  const found = new Set(rows.map((row) => String(row.id)));
  const missing = unique.filter((id) => !found.has(id));
  if (missing.length) throw badRequest(`员工不存在：${missing.join('、')}`);
  return unique;
}

/** 先清空本组，再把所选员工从其他组移入；每名员工只保留一个考勤组。 */
async function replaceMembers(conn: PoolConnection, groupId: number, employeeIds: string[]): Promise<void> {
  await conn.query('DELETE FROM attendance_group_employees WHERE group_id = ?', [groupId]);
  if (!employeeIds.length) return;
  const placeholders = employeeIds.map(() => '?').join(',');
  await conn.query(`DELETE FROM attendance_group_employees WHERE employee_id IN (${placeholders})`, employeeIds);
  for (const employeeId of employeeIds) {
    await conn.query(
      'INSERT INTO attendance_group_employees (employee_id, group_id, created_at) VALUES (?, ?, NOW())',
      [employeeId, groupId]
    );
  }
}

export async function listAttendanceGroups(): Promise<AttendanceGroupsResult> {
  const [rows, members, initialSettings] = await Promise.all([
    queryRows<GroupRow>(`${GROUP_SELECT} ORDER BY g.id ASC`),
    queryRows<{ group_id: number; employee_id: string }>(
      'SELECT group_id, employee_id FROM attendance_group_employees ORDER BY employee_id ASC'
    ),
    getAttendanceSettings(),
  ]);

  const memberMap = new Map<number, string[]>();
  for (const member of members) {
    const groupId = Number(member.group_id);
    const list = memberMap.get(groupId) ?? [];
    list.push(member.employee_id);
    memberMap.set(groupId, list);
  }

  return {
    groups: rows.map((row) => mapGroup(row, memberMap.get(Number(row.id)) ?? [])),
    initialSettings,
  };
}

/**
 * 按员工读取考勤设置和公司日历：
 * - 属于考勤组的员工使用组设置和组选择的日历；
 * - 未分配员工使用第一个考勤组（按创建顺序）；
 * - 完全无组时回退初始考勤设置，并沿用旧的显式休息日期。
 */
export async function getAttendanceConfigMap(
  employeeIds: string[]
): Promise<Map<string, EmployeeAttendanceConfig>> {
  const result = new Map<string, EmployeeAttendanceConfig>();
  const unique = Array.from(new Set(employeeIds));
  if (!unique.length) return result;

  const placeholders = unique.map(() => '?').join(',');
  const [firstGroup, initialSettings, rows] = await Promise.all([
    queryOne<GroupRow>(`${GROUP_SELECT} ORDER BY g.id ASC LIMIT 1`),
    getAttendanceSettings(),
    queryRows<GroupRow & { employee_id: string }>(
      `SELECT m.employee_id, g.*, r.name AS calendar_rule_name
       FROM attendance_group_employees m
       JOIN attendance_groups g ON g.id = m.group_id
       LEFT JOIN company_calendar_rules r ON r.id = g.calendar_rule_id
       WHERE m.employee_id IN (${placeholders})`,
      unique
    ),
  ]);

  const ruleIds = new Set<number>();
  if (firstGroup?.calendar_rule_id) ruleIds.add(Number(firstGroup.calendar_rule_id));
  rows.forEach((row) => { if (row.calendar_rule_id) ruleIds.add(Number(row.calendar_rule_id)); });
  const rules = await getCompanyCalendarRulesByIds(Array.from(ruleIds));
  const firstRule = firstGroup?.calendar_rule_id ? rules.get(Number(firstGroup.calendar_rule_id)) ?? null : null;
  const fallbackRule = firstRule ?? (firstGroup ? await getDefaultCompanyCalendarRule() : null);
  const memberMap = new Map(rows.map((row) => [row.employee_id, row]));

  for (const employeeId of unique) {
    const group = memberMap.get(employeeId) ?? firstGroup;
    const settings = group ? mapAttendanceSettingsRow(group) : initialSettings;
    const calendarRule = group
      ? (group.calendar_rule_id ? rules.get(Number(group.calendar_rule_id)) ?? fallbackRule : fallbackRule)
      : null;
    result.set(employeeId, { settings, calendarRule });
  }
  return result;
}

export async function getAttendanceConfigForEmployee(
  employeeId: string
): Promise<EmployeeAttendanceConfig> {
  const config = await getAttendanceConfigMap([employeeId]);
  return config.get(employeeId) ?? { settings: null, calendarRule: null };
}

export async function getAttendanceSettingsMap(
  employeeIds: string[]
): Promise<Map<string, AttendanceSettings | null>> {
  const configs = await getAttendanceConfigMap(employeeIds);
  return new Map(Array.from(configs.entries()).map(([id, config]) => [id, config.settings]));
}

export async function getAttendanceSettingsForEmployee(
  employeeId: string
): Promise<AttendanceSettings | null> {
  const config = await getAttendanceConfigForEmployee(employeeId);
  return config.settings;
}

export async function createAttendanceGroup(
  input: AttendanceGroupInput,
  admin: AdminUser
): Promise<AttendanceGroup> {
  const settings = attendanceSettingsSchema.parse(input);
  const meta = attendanceGroupMetaSchema.parse(input);
  await assertCalendarRule(meta.calendarRuleId);
  const employeeIds = await validateEmployeeIds(meta.employeeIds);
  await assertNameAvailable(meta.name);

  const groupId = await transaction(async (conn) => {
    const [result] = await conn.query<ResultSetHeader>(
      `INSERT INTO attendance_groups
        (name, calendar_rule_id, start_time, in_end_time, end_time, out_end_time, rest_dates, latitude, longitude, radius, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, NOW(), NOW())`,
      [
        meta.name,
        meta.calendarRuleId,
        settings.startTime,
        settings.inEndTime,
        settings.endTime,
        settings.outEndTime,
        settings.latitude,
        settings.longitude,
        settings.radius,
      ]
    );
    const id = Number(result.insertId);
    await replaceMembers(conn, id, employeeIds);
    return id;
  });

  const group = await getGroupById(groupId);
  if (!group) throw new Error('考勤组创建失败');
  await recordAdminLog(admin, '创建考勤组', 'attendance_group', String(groupId), {
    name: group.name,
    calendarRuleId: meta.calendarRuleId,
    employeeIds,
    settings,
  });
  return group;
}

export async function updateAttendanceGroup(
  id: number,
  input: AttendanceGroupInput,
  admin: AdminUser
): Promise<AttendanceGroup> {
  const existing = await getGroupById(id);
  if (!existing) throw notFound('考勤组不存在');

  const settings = attendanceSettingsSchema.parse(input);
  const meta = attendanceGroupMetaSchema.parse(input);
  await assertCalendarRule(meta.calendarRuleId);
  const employeeIds = await validateEmployeeIds(meta.employeeIds);
  await assertNameAvailable(meta.name, id);

  await transaction(async (conn) => {
    await conn.query(
      `UPDATE attendance_groups
       SET name = ?, calendar_rule_id = ?, start_time = ?, in_end_time = ?, end_time = ?, out_end_time = ?,
           rest_dates = '[]', latitude = ?, longitude = ?, radius = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        meta.name,
        meta.calendarRuleId,
        settings.startTime,
        settings.inEndTime,
        settings.endTime,
        settings.outEndTime,
        settings.latitude,
        settings.longitude,
        settings.radius,
        id,
      ]
    );
    await replaceMembers(conn, id, employeeIds);
  });

  const group = await getGroupById(id);
  if (!group) throw new Error('考勤组更新失败');
  await recordAdminLog(admin, '修改考勤组', 'attendance_group', String(id), {
    name: group.name,
    calendarRuleId: meta.calendarRuleId,
    employeeIds,
    settings,
  });
  return group;
}

export async function deleteAttendanceGroup(id: number, admin: AdminUser): Promise<void> {
  const existing = await getGroupById(id);
  if (!existing) throw notFound('考勤组不存在');

  await transaction(async (conn) => {
    await conn.query('DELETE FROM attendance_group_employees WHERE group_id = ?', [id]);
    await conn.query('DELETE FROM attendance_groups WHERE id = ?', [id]);
  });
  await recordAdminLog(admin, '删除考勤组', 'attendance_group', String(id), {
    name: existing.name,
    employeeIds: existing.employeeIds,
  });
}
