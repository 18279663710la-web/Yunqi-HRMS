import { normalizeAttendanceRules, validateAttendanceRules, type AttendanceRule } from './attendanceRules';

import type { AttendanceRange, AttendanceRuleMode } from '../../hr/api';
export type { AttendanceRange, AttendanceRuleMode } from '../../hr/api';

export function defaultModeRules(mode: AttendanceRuleMode): AttendanceRange[] {
  if (mode === 'rate_attendance') return normalizeAttendanceRules([]);
  return [{ minRate: 0, maxRate: mode === 'rate_absence' ? 100 : null, adjustment: 0 }];
}

export function buildRanges(mode: AttendanceRuleMode, values: AttendanceRange[] | undefined): AttendanceRange[] {
  const rules = Array.isArray(values) ? values : [];
  return rules.map((rule, index) => ({
    minRate: index === 0 ? 0 : rules[index - 1]?.maxRate ?? 0,
    maxRate: index === rules.length - 1 ? (mode === 'rate_absence' ? 100 : null) : rule.maxRate,
    adjustment: rule.adjustment,
  }));
}

export function validateRanges(mode: AttendanceRuleMode, rules: AttendanceRange[] | undefined): string | undefined {
  if (mode === 'rate_attendance') return validateAttendanceRules(rules as AttendanceRule[] | undefined);
  if (!rules?.length || rules.length > 30) return '请设置 1 至 30 条规则';
  const days = mode.startsWith('days_');
  const precise = (value: number) => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]; const last = i === rules.length - 1;
    if (!rule || typeof rule.minRate !== 'number' || !Number.isFinite(rule.minRate) || rule.minRate < 0 || rule.minRate > 999999 || (rule.maxRate !== null && (typeof rule.maxRate !== 'number' || !Number.isFinite(rule.maxRate) || rule.maxRate > 999999))) return '请完整填写每条规则';
    if (typeof rule.adjustment !== 'number' || !Number.isFinite(rule.adjustment) || Math.abs(rule.adjustment) > 9999999999.99 || !precise(rule.adjustment)) return '调整金额无效，最多两位小数';
    if (days && (!Number.isInteger(rule.minRate) || (rule.maxRate !== null && !Number.isInteger(rule.maxRate)))) return '天数须为非负整数';
    if (!days && (rule.minRate > 100 || !precise(rule.minRate) || (rule.maxRate !== null && (rule.maxRate > 100 || !precise(rule.maxRate))))) return '比例须在 0% 到 100% 之间，最多两位小数';
    if ((i === 0 && rule.minRate !== 0) || (i > 0 && rule.minRate !== rules[i - 1].maxRate) || (!last && (rule.maxRate === null || rule.maxRate <= rule.minRate)) || (last && (days ? rule.maxRate !== null : rule.maxRate !== 100 || rule.maxRate <= rule.minRate))) return '区间须连续覆盖完整范围';
  }
  return undefined;
}
