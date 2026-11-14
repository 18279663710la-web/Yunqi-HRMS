import { z } from 'zod';

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
export function isPaidOvertime(value: unknown): boolean {
  let form = value;
  if (typeof form === 'string') { try { form = JSON.parse(form); } catch { return false; } }
  const compensation = Array.isArray(form) ? form.filter((item: { label?: string }) => item?.label === '补偿方式') : [];
  return compensation.length === 1 && compensation[0].value === '加班费';
}

export function calculateOvertimePay(seconds: number, rules: OvertimeRule[]) {
  const matched = rules.find(rule => seconds >= rule.minHours * 3600 && (rule.maxHours === null || seconds < rule.maxHours * 3600));
  const amount = Math.round(seconds * Math.round((matched?.hourlyRate || 0) * 100) / 3600) / 100;
  return { seconds, amount, matchedRule: matched || null };
}
