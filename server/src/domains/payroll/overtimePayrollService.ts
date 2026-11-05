import { z } from 'zod';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { conflict } from '../../shared/utils/errors';

const hours = z.number().finite().min(0).max(1000000).multipleOf(0.01);
const hourlyRate = z.number().finite().min(0).max(9999999999.99).multipleOf(0.01);
export const overtimeRulesSchema = z.array(z.object({ minHours: hours, maxHours: hours.nullable(), hourlyRate })).min(1).max(30).superRefine((rules, ctx) => {
  if (rules[0]?.minHours !== 0) ctx.addIssue({ code: 'custom', message: '加班区间须从 0 小时开始' });
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (i === rules.length - 1 ? rule.maxHours !== null : rule.maxHours === null || rule.maxHours <= rule.minHours || rule.maxHours !== rules[i + 1].minHours) {
      ctx.addIssue({ code: 'custom', message: '加班区间须连续且最后一条无上限' }); return;
    }
  }
});
export type OvertimeRule = z.infer<typeof overtimeRulesSchema>[number];
export const overtimeRuleConfigSchema = z.discriminatedUnion('calculation', [
  z.object({ calculation: z.literal('range'), rules: overtimeRulesSchema }).strict(),
  z.object({ calculation: z.literal('unit'), hourlyRate }).strict(),
]);
export type OvertimeRuleConfig = z.infer<typeof overtimeRuleConfigSchema>;
export const overtimeRulesKey = 'payroll_overtime_rules';
export const overtimeRuleConfigKey = 'payroll_overtime_rule_config';
export const defaultOvertimeRules: OvertimeRule[] = [{ minHours: 0, maxHours: null, hourlyRate: 0 }];
function isPaidOvertime(value: unknown): boolean {
  let form = value;
  if (typeof form === 'string') { try { form = JSON.parse(form); } catch { return false; } }
  const compensation = Array.isArray(form) ? form.filter((item: { label?: string }) => item?.label === '补偿方式') : [];
  return compensation.length === 1 && compensation[0].value === '加班费';
}

export async function hasOpenPaidOvertime(conn: PoolConnection, employeeId: string, month: string) {
  const [rows] = await conn.query<RowDataPacket[]>(`SELECT a.form_json FROM attendance_overtime_punches p JOIN approvals a ON a.id = p.approval_id WHERE p.employee_id = ? AND p.check_in >= ? AND p.check_in < DATE_ADD(?, INTERVAL 1 MONTH) AND p.check_out IS NULL AND a.status = 'approved' FOR UPDATE`, [employeeId, `${month}-01`, `${month}-01`]);
  return rows.some(row => isPaidOvertime(row.form_json));
}

export function calculateOvertimePay(seconds: number, rules: OvertimeRule[]) {
  const matched = rules.find(rule => seconds >= rule.minHours * 3600 && (rule.maxHours === null || seconds < rule.maxHours * 3600));
  const amount = Math.round(seconds * Math.round((matched?.hourlyRate || 0) * 100) / 3600) / 100;
  return { seconds, amount, matchedRule: matched || null };
}

export async function calculateEmployeeOvertime(conn: PoolConnection, employeeId: string, month: string, suppliedRules?: OvertimeRule[]) {
  let rules = suppliedRules;
  if (!rules) {
    const [settings] = await conn.query<RowDataPacket[]>('SELECT setting_key, value_json FROM hr_settings WHERE setting_key IN (?, ?)', [overtimeRuleConfigKey, overtimeRulesKey]);
    const decode = (value: unknown) => typeof value === 'string' ? JSON.parse(value) : value;
    const active = settings.find(row => row.setting_key === overtimeRuleConfigKey);
    if (active) {
      const config = overtimeRuleConfigSchema.parse(decode(active.value_json));
      if (config.calculation === 'unit') throw conflict('当前加班规则按单位计算，旧计算入口不支持，请使用新版流程');
      rules = config.rules;
    } else {
      const legacy = settings.find(row => row.setting_key === overtimeRulesKey);
      rules = legacy ? overtimeRulesSchema.parse(decode(legacy.value_json)) : defaultOvertimeRules;
    }
  }
  const [rows] = await conn.query<RowDataPacket[]>(`SELECT a.form_json, TIMESTAMPDIFF(SECOND, p.check_in, p.check_out) AS seconds FROM attendance_overtime_punches p JOIN approvals a ON a.id = p.approval_id WHERE p.employee_id = ? AND p.check_in >= ? AND p.check_in < DATE_ADD(?, INTERVAL 1 MONTH) AND p.check_out IS NOT NULL AND a.status = 'approved'`, [employeeId, `${month}-01`, `${month}-01`]);
  const seconds = rows.reduce((sum, row) => {
    return sum + (isPaidOvertime(row.form_json) ? Math.max(0, Number(row.seconds)) : 0);
  }, 0);
  return { ...calculateOvertimePay(seconds, rules), rules };
}
