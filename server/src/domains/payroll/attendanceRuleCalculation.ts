import { badRequest } from '../../shared/utils/errors';
import type { AttendanceRuleConfig } from './attendanceRuleConfig';

export function calculateAttendanceRule(config: AttendanceRuleConfig, presentDays: number, workdays: number) {
  if (!Number.isInteger(workdays) || workdays <= 0 || !Number.isInteger(presentDays) || presentDays < 0 || presentDays > workdays) throw badRequest('应出勤或实际出勤天数无效，无法计算出勤绩效');
  const days = config.mode.endsWith('absence') ? workdays - presentDays : presentDays;
  const input = config.mode.startsWith('rate') ? Math.round(days * 10000 / workdays) / 100 : days;
  if (config.calculation === 'unit') {
    const cents = Math.round(Math.abs(input * Math.round(config.unitAdjustment * 100))) * Math.sign(config.unitAdjustment);
    return { input, amount: cents / 100, matchedRule: null };
  }
  const matchedRule = config.rules.find(rule => config.mode === 'rate_attendance' && rule.minRate === 100 && rule.maxRate === 100 ? input === 100 : input >= rule.minRate && (rule.maxRate === null || input < rule.maxRate || (config.mode === 'rate_absence' && rule.maxRate === 100 && input === 100)));
  if (!matchedRule) throw badRequest('出勤绩效规则未覆盖考勤数据');
  return { input, amount: matchedRule.adjustment, matchedRule };
}
