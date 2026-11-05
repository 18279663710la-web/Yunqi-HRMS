import { ApiError } from '../../../api/client';
import type { AttendanceRuleConfig } from '../../hr/api';

export type AttendanceRuleLoadResult =
  | { status: 'ready'; config: AttendanceRuleConfig }
  | { status: 'conflict'; message: string }
  | { status: 'error'; message: string };

export async function loadAttendanceRuleConfig(load: () => Promise<AttendanceRuleConfig>): Promise<AttendanceRuleLoadResult> {
  try {
    const config = await load();
    const modes = ['rate_attendance', 'rate_absence', 'days_attendance', 'days_absence'];
    if (!config || !modes.includes(config.mode) || (config.calculation !== undefined && config.calculation !== 'range' && config.calculation !== 'unit')) throw new Error('规则数据格式无效，请重试');
    if (config.calculation === 'unit') {
      if (typeof config.unitAdjustment !== 'number' || !Number.isFinite(config.unitAdjustment)) throw new Error('规则数据格式无效，请重试');
    } else if (!Array.isArray(config.rules) || config.rules.some(rule => !rule || typeof rule.minRate !== 'number' || !Number.isFinite(rule.minRate) || (rule.maxRate !== null && (typeof rule.maxRate !== 'number' || !Number.isFinite(rule.maxRate))) || typeof rule.adjustment !== 'number' || !Number.isFinite(rule.adjustment))) throw new Error('规则数据格式无效，请重试');
    return { status: 'ready', config };
  }
  catch (error) {
    const message = error instanceof Error ? error.message : '请检查服务状态并重试';
    return { status: error instanceof ApiError && error.status === 409 ? 'conflict' : 'error', message };
  }
}
