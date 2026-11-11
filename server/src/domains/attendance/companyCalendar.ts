import type { ResultSetHeader } from 'mysql2/promise';
import { z } from 'zod';

import { queryOne, queryRows, transaction } from '../../shared/db/pool';
import type { AdminUser } from '../../shared/types/admin';
import { conflict, notFound } from '../../shared/utils/errors';
import { recordAdminLog } from '../audit/adminLogService';

export type CompanyCalendarMode = 'none' | 'weekly' | 'cycle';

export interface CompanyCalendarRule {
  id: number;
  name: string;
  mode: CompanyCalendarMode;
  weeklyRestDays: number[];
  cycleWeeks: number | null;
  cycleRestDays: number[][];
  anchorDate: string | null;
  restDates: string[];
  workDates: string[];
  usageCount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CompanyCalendarRuleInput {
  name: string;
  mode: CompanyCalendarMode;
  weeklyRestDays: number[];
  cycleWeeks?: number | null;
  cycleRestDays: number[][];
  anchorDate?: string | null;
  restDates: string[];
  workDates: string[];
}

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD').refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, '日期无效');
const weekday = z.number().int().min(0).max(6);

export const companyCalendarRuleSchema = z.object({
  name: z.string().trim().min(1, '日历名称不能为空').max(50, '日历名称不能超过 50 个字符'),
  mode: z.enum(['none', 'weekly', 'cycle']),
  weeklyRestDays: z.array(weekday).max(7).default([]),
  cycleWeeks: z.number().int().min(1).max(8).nullable().optional(),
  cycleRestDays: z.array(z.array(weekday).max(7)).max(8).default([]),
  anchorDate: dateString.nullable().optional(),
  restDates: z.array(dateString).max(1000).default([]),
  workDates: z.array(dateString).max(1000).default([]),
}).superRefine((value, ctx) => {
  if (value.mode === 'cycle') {
    if (!value.cycleWeeks) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cycleWeeks'], message: '按周轮换需要设置周期周数' });
    }
    if (!value.anchorDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['anchorDate'], message: '按周轮换需要设置起始周' });
    }
    if (value.cycleWeeks && value.cycleRestDays.length !== value.cycleWeeks) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cycleRestDays'], message: '每周休息日数量必须与周期周数一致' });
    }
  }
  const overlap = value.restDates.find((date) => value.workDates.includes(date));
  if (overlap) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['workDates'], message: `${overlap} 不能同时设置为休息和上班` });
  }
});

export interface CalendarRuleRow {
  id: number;
  name: string;
  mode: CompanyCalendarMode;
  weekly_rest_days: unknown;
  cycle_weeks: number | null;
  cycle_rest_days: unknown;
  anchor_date: string | null;
  rest_dates: unknown;
  work_dates: unknown;
  usage_count?: number;
  created_at: string | null;
  updated_at: string | null;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return value as T;
}

export function mapCompanyCalendarRuleRow(row: CalendarRuleRow): CompanyCalendarRule {
  return {
    id: Number(row.id),
    name: row.name,
    mode: row.mode,
    weeklyRestDays: parseJson<number[]>(row.weekly_rest_days, []),
    cycleWeeks: row.cycle_weeks == null ? null : Number(row.cycle_weeks),
    cycleRestDays: parseJson<number[][]>(row.cycle_rest_days, []),
    anchorDate: row.anchor_date ? String(row.anchor_date).slice(0, 10) : null,
    restDates: parseJson<string[]>(row.rest_dates, []),
    workDates: parseJson<string[]>(row.work_dates, []),
    usageCount: Number(row.usage_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

function uniqueDates(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function normalize(input: CompanyCalendarRuleInput): CompanyCalendarRuleInput {
  const mode = input.mode;
  return {
    name: input.name.trim(),
    mode,
    weeklyRestDays: mode === 'weekly' ? uniqueNumbers(input.weeklyRestDays) : [],
    cycleWeeks: mode === 'cycle' ? Number(input.cycleWeeks) : null,
    cycleRestDays: mode === 'cycle' ? input.cycleRestDays.map(uniqueNumbers) : [],
    anchorDate: mode === 'cycle' ? input.anchorDate ?? null : null,
    restDates: uniqueDates(input.restDates),
    workDates: uniqueDates(input.workDates),
  };
}

async function assertNameAvailable(name: string, excludeId?: number): Promise<void> {
  const row = await queryOne<{ id: number }>(
    'SELECT id FROM company_calendar_rules WHERE name = ? AND id <> ? LIMIT 1',
    [name, excludeId ?? 0]
  );
  if (row) throw conflict('日历名称已存在');
}

export async function listCompanyCalendarRules(): Promise<CompanyCalendarRule[]> {
  const rows = await queryRows<CalendarRuleRow>(
    `SELECT r.*, (SELECT COUNT(*) FROM attendance_groups g WHERE g.calendar_rule_id = r.id) AS usage_count
     FROM company_calendar_rules r ORDER BY r.id ASC`
  );
  return rows.map(mapCompanyCalendarRuleRow);
}

export async function getCompanyCalendarRule(id: number): Promise<CompanyCalendarRule | null> {
  const row = await queryOne<CalendarRuleRow>('SELECT * FROM company_calendar_rules WHERE id = ?', [id]);
  return row ? mapCompanyCalendarRuleRow(row) : null;
}

export async function getCompanyCalendarRulesByIds(ids: number[]): Promise<Map<number, CompanyCalendarRule>> {
  const unique = Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
  const result = new Map<number, CompanyCalendarRule>();
  if (!unique.length) return result;
  const placeholders = unique.map(() => '?').join(',');
  const rows = await queryRows<CalendarRuleRow>(
    `SELECT * FROM company_calendar_rules WHERE id IN (${placeholders})`,
    unique
  );
  rows.forEach((row) => result.set(Number(row.id), mapCompanyCalendarRuleRow(row)));
  return result;
}

export async function getDefaultCompanyCalendarRule(): Promise<CompanyCalendarRule | null> {
  const row = await queryOne<CalendarRuleRow>('SELECT * FROM company_calendar_rules ORDER BY id ASC LIMIT 1');
  return row ? mapCompanyCalendarRuleRow(row) : null;
}

export async function createCompanyCalendarRule(
  input: CompanyCalendarRuleInput,
  admin: AdminUser
): Promise<CompanyCalendarRule> {
  const settings = normalize(companyCalendarRuleSchema.parse(input));
  await assertNameAvailable(settings.name);
  const id = await transaction(async (conn) => {
    const [result] = await conn.query<ResultSetHeader>(
      `INSERT INTO company_calendar_rules
        (name, mode, weekly_rest_days, cycle_weeks, cycle_rest_days, anchor_date, rest_dates, work_dates, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        settings.name, settings.mode, JSON.stringify(settings.weeklyRestDays),
        settings.cycleWeeks ?? null, JSON.stringify(settings.cycleRestDays), settings.anchorDate ?? null,
        JSON.stringify(settings.restDates), JSON.stringify(settings.workDates),
      ]
    );
    return Number(result.insertId);
  });
  const rule = await getCompanyCalendarRule(id);
  if (!rule) throw new Error('公司日历创建失败');
  await recordAdminLog(admin, '创建公司日历', 'company_calendar_rule', String(id), { name: rule.name, mode: rule.mode });
  return rule;
}

export async function updateCompanyCalendarRule(
  id: number,
  input: CompanyCalendarRuleInput,
  admin: AdminUser
): Promise<CompanyCalendarRule> {
  const existing = await getCompanyCalendarRule(id);
  if (!existing) throw notFound('公司日历不存在');
  const settings = normalize(companyCalendarRuleSchema.parse(input));
  await assertNameAvailable(settings.name, id);
  await transaction(async (conn) => {
    await conn.query(
      `UPDATE company_calendar_rules
       SET name = ?, mode = ?, weekly_rest_days = ?, cycle_weeks = ?, cycle_rest_days = ?,
           anchor_date = ?, rest_dates = ?, work_dates = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        settings.name, settings.mode, JSON.stringify(settings.weeklyRestDays),
        settings.cycleWeeks ?? null, JSON.stringify(settings.cycleRestDays), settings.anchorDate ?? null,
        JSON.stringify(settings.restDates), JSON.stringify(settings.workDates), id,
      ]
    );
  });
  const rule = await getCompanyCalendarRule(id);
  if (!rule) throw new Error('公司日历更新失败');
  await recordAdminLog(admin, '修改公司日历', 'company_calendar_rule', String(id), { name: rule.name, mode: rule.mode });
  return rule;
}

export async function deleteCompanyCalendarRule(id: number, admin: AdminUser): Promise<void> {
  const existing = await getCompanyCalendarRule(id);
  if (!existing) throw notFound('公司日历不存在');
  const usage = await queryOne<{ total: number }>(
    'SELECT COUNT(*) AS total FROM attendance_groups WHERE calendar_rule_id = ?',
    [id]
  );
  if (Number(usage?.total || 0) > 0) throw conflict('该日历已被考勤组使用，不能删除');
  await transaction(async (conn) => {
    await conn.query('DELETE FROM company_calendar_rules WHERE id = ?', [id]);
  });
  await recordAdminLog(admin, '删除公司日历', 'company_calendar_rule', String(id), { name: existing.name });
}

const DAY_MS = 86400000;

function parseDateOnly(value: string): number {
  return Date.parse(`${value}T00:00:00Z`);
}

function formatDateOnly(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

function weekdayOf(value: string): number {
  return new Date(parseDateOnly(value)).getUTCDay();
}

/** 以周一为一周起点，返回该周周一的 UTC 毫秒数。 */
function mondayOf(value: string): number {
  const time = parseDateOnly(value);
  const day = new Date(time).getUTCDay();
  return time - ((day + 6) % 7) * DAY_MS;
}

function cycleIndex(rule: CompanyCalendarRule, date: string): number {
  if (!rule.anchorDate || !rule.cycleWeeks) return 0;
  const weeks = Math.round((mondayOf(date) - mondayOf(rule.anchorDate)) / (7 * DAY_MS));
  return ((weeks % rule.cycleWeeks) + rule.cycleWeeks) % rule.cycleWeeks;
}

export function isCalendarRestDate(rule: CompanyCalendarRule, date: string): boolean {
  if (rule.workDates.includes(date)) return false;
  if (rule.restDates.includes(date)) return true;
  const weekday = weekdayOf(date);
  if (rule.mode === 'weekly') return rule.weeklyRestDays.includes(weekday);
  if (rule.mode === 'cycle') {
    return rule.cycleRestDays[cycleIndex(rule, date)]?.includes(weekday) ?? false;
  }
  return false;
}

export function resolveCalendarRestDates(rule: CompanyCalendarRule, from: string, to: string): Set<string> {
  const result = new Set<string>();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return result;
  const start = parseDateOnly(from);
  const end = parseDateOnly(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return result;
  // 限制异常范围，避免误传超大区间造成长循环。
  const maxDays = 3660;
  if ((end - start) / DAY_MS > maxDays) return result;
  for (let time = start; time <= end; time += DAY_MS) {
    const date = formatDateOnly(time);
    if (isCalendarRestDate(rule, date)) result.add(date);
  }
  return result;
}

/** 有日历时按日历解析；无日历（兼容旧数据）时使用显式休息日期。 */
export function resolveConfiguredRestDates(
  rule: CompanyCalendarRule | null,
  legacyRestDates: string[],
  from: string,
  to: string
): Set<string> {
  if (rule) return resolveCalendarRestDates(rule, from, to);
  return new Set(legacyRestDates.filter((date) => date >= from && date <= to));
}
