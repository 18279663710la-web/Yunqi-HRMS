import { z } from 'zod';

const amount = z.number().finite().min(-9999999999.99).max(9999999999.99).multipleOf(0.01);
const rate = z.number().finite().min(0).max(100).multipleOf(0.01);
const legacyRule = z.object({ minRate: rate, maxRate: rate, adjustment: amount })
  .refine(rule => rule.minRate < rule.maxRate || (rule.minRate === 100 && rule.maxRate === 100), '出勤率区间无效');

export const payrollAttendanceRulesSchema = z.array(legacyRule).min(2, '至少保留全勤规则和一条区间规则').max(30).superRefine((rules, ctx) => {
  if (rules.length < 2) return;
  if (rules[0].minRate !== 100 || rules[0].maxRate !== 100) { ctx.addIssue({ code: 'custom', message: '区间1必须为全勤规则' }); return; }
  for (let index = 1; index < rules.length; index++) {
    const previous = rules[index - 1]; const current = rules[index];
    if (current.minRate === 100 && current.maxRate === 100) { ctx.addIssue({ code: 'custom', message: '只能设置一条全勤规则' }); return; }
    if (current.maxRate !== previous.minRate) { ctx.addIssue({ code: 'custom', message: `区间${index + 1}的上限必须等于上一条规则的下限` }); return; }
    if (index < rules.length - 1 && current.minRate <= 0) { ctx.addIssue({ code: 'custom', message: '中间规则的下限必须大于 0' }); return; }
  }
  if (rules[rules.length - 1].minRate !== 0) ctx.addIssue({ code: 'custom', message: '最后一条规则的下限必须为 0' });
});

const mode = z.enum(['rate_attendance', 'rate_absence', 'days_attendance', 'days_absence']);
export const attendanceRangeRuleConfigSchema = z.object({
  mode,
  calculation: z.literal('range').optional(),
  rules: z.array(z.object({ minRate: z.number().finite().min(0).max(999999), maxRate: z.number().finite().min(0).max(999999).nullable(), adjustment: amount })).min(1).max(30),
}).strict().superRefine((config, ctx) => {
  if (config.mode === 'rate_attendance') {
    const valid = payrollAttendanceRulesSchema.safeParse(config.rules);
    if (!valid.success) for (const issue of valid.error.issues) ctx.addIssue({ code: 'custom', message: issue.message, path: ['rules', ...issue.path] });
    return;
  }
  const isDays = config.mode.startsWith('days_');
  const { rules } = config;
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]; const last = i === rules.length - 1;
    if ((isDays && (!Number.isInteger(rule.minRate) || (rule.maxRate !== null && !Number.isInteger(rule.maxRate)))) || (!isDays && (rule.minRate > 100 || (rule.maxRate !== null && rule.maxRate > 100) || Math.abs(rule.minRate * 100 - Math.round(rule.minRate * 100)) > 1e-6 || (rule.maxRate !== null && Math.abs(rule.maxRate * 100 - Math.round(rule.maxRate * 100)) > 1e-6)))) {
      ctx.addIssue({ code: 'custom', message: isDays ? '天数须为非负整数' : '比例须在 0% 到 100% 之间，最多两位小数' }); return;
    }
    if ((i === 0 && rule.minRate !== 0) || (i > 0 && rule.minRate !== rules[i - 1].maxRate) || (!last && (rule.maxRate === null || rule.maxRate <= rule.minRate)) || (last && (isDays ? rule.maxRate !== null : rule.maxRate !== 100 || rule.maxRate <= rule.minRate))) {
      ctx.addIssue({ code: 'custom', message: '区间须连续覆盖完整范围，天数最高区间不设上限' }); return;
    }
  }
});
const attendanceUnitRuleConfigSchema = z.object({ mode, calculation: z.literal('unit'), unitAdjustment: amount }).strict();
export const attendanceRuleConfigSchema = z.union([attendanceUnitRuleConfigSchema, attendanceRangeRuleConfigSchema]);
export type AttendanceRuleConfig = z.infer<typeof attendanceRuleConfigSchema>;
