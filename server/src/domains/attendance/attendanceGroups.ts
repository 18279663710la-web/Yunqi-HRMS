import type { PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { z } from 'zod';

import { queryOne, queryRows, transaction } from '../../shared/db/pool';
import type { AdminUser } from '../../shared/types/admin';
import { badRequest, conflict, notFound } from '../../shared/utils/errors';
import { recordAdminLog } from '../audit/adminLogService';
import { attendanceSettingsSchema } from './attendancePolicy';
import {
  getAttendanceSettings,
  mapAttendanceSettingsRow,
  type AttendanceSettings,
  type AttendanceSettingsInput,
  type AttendanceSettingsRow,
} from './attendanceSettings';

export const attendanceGroupMetaSchema = z.object({
  name: z.string().trim().min(1, '考勤组名称不能为空').max(50, '考勤组名称不能超过 50 个字符'),
  employeeIds: z.array(z.string().min(1).max(10)).max(1000, '单个考勤组最多选择 1000 名员工'),
});

export type AttendanceGroupMeta = z.infer<typeof attendanceGroupMetaSchema>;
export type AttendanceGroupInput = AttendanceSettingsInput & AttendanceGroupMeta;

export interface AttendanceGroup extends AttendanceSettings {
  id: number;
  name: string;
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

interface GroupRow extends AttendanceSettingsRow {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

function mapGroup(row: GroupRow, employeeIds: string[]): AttendanceGroup {
  return {
    id: Number(row.id),
    name: row.name,
    ...mapAttendanceSettingsRow(row),
    employeeIds,
    employeeCount: employeeIds.length,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getGroupById(id: number): Promise<AttendanceGroup | null> {
  const row = await queryOne<GroupRow>('SELECT * FROM attendance_groups WHERE id = ?', [id]);
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
    queryRows<GroupRow>('SELECT * FROM attendance_groups ORDER BY id ASC'),
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
 * 按员工读取考勤设置：属于考勤组的员工使用组设置；
 * 未分配员工使用第一个考勤组（按创建顺序），完全无组时回退初始考勤设置。
 */
export async function getAttendanceSettingsMap(
  employeeIds: string[]
): Promise<Map<string, AttendanceSettings | null>> {
  const result = new Map<string, AttendanceSettings | null>();
  const unique = Array.from(new Set(employeeIds));
  if (!unique.length) return result;

  const placeholders = unique.map(() => '?').join(',');
  const [fallbackGroup, initialSettings, rows] = await Promise.all([
    queryOne<GroupRow>('SELECT * FROM attendance_groups ORDER BY id ASC LIMIT 1'),
    getAttendanceSettings(),
    queryRows<GroupRow & { employee_id: string }>(
      `SELECT m.employee_id, g.*
       FROM attendance_group_employees m
       JOIN attendance_groups g ON g.id = m.group_id
       WHERE m.employee_id IN (${placeholders})`,
      unique
    ),
  ]);

  const byEmployee = new Map<string, AttendanceSettings>();
  for (const row of rows) {
    byEmployee.set(row.employee_id, mapAttendanceSettingsRow(row));
  }
  const fallback = fallbackGroup ? mapAttendanceSettingsRow(fallbackGroup) : initialSettings;
  for (const employeeId of unique) {
    result.set(employeeId, byEmployee.get(employeeId) ?? fallback);
  }
  return result;
}

export async function getAttendanceSettingsForEmployee(
  employeeId: string
): Promise<AttendanceSettings | null> {
  const settings = await getAttendanceSettingsMap([employeeId]);
  return settings.get(employeeId) ?? null;
}

export async function createAttendanceGroup(
  input: AttendanceGroupInput,
  admin: AdminUser
): Promise<AttendanceGroup> {
  const settings = attendanceSettingsSchema.parse(input);
  const meta = attendanceGroupMetaSchema.parse(input);
  const employeeIds = await validateEmployeeIds(meta.employeeIds);
  await assertNameAvailable(meta.name);

  const groupId = await transaction(async (conn) => {
    const [result] = await conn.query<ResultSetHeader>(
      `INSERT INTO attendance_groups
        (name, start_time, in_end_time, end_time, out_end_time, rest_dates, latitude, longitude, radius, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        meta.name,
        settings.startTime,
        settings.inEndTime,
        settings.endTime,
        settings.outEndTime,
        JSON.stringify(settings.restDates),
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
  const employeeIds = await validateEmployeeIds(meta.employeeIds);
  await assertNameAvailable(meta.name, id);

  await transaction(async (conn) => {
    await conn.query(
      `UPDATE attendance_groups
       SET name = ?, start_time = ?, in_end_time = ?, end_time = ?, out_end_time = ?, rest_dates = ?,
           latitude = ?, longitude = ?, radius = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        meta.name,
        settings.startTime,
        settings.inEndTime,
        settings.endTime,
        settings.outEndTime,
        JSON.stringify(settings.restDates),
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
