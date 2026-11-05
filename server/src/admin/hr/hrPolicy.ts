import { z } from 'zod';

export const onboardingFieldsSchema = z.array(z.string().trim().min(1).max(30)).min(1).max(30)
  .refine((fields) => new Set(fields).size === fields.length, '字段名称不能重复');

export const payrollRecordSchema = z.object({
  employeeId: z.string().trim().min(1).max(10),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, '月份格式无效'),
  amount: z.number().finite().min(0).max(9999999999.99).multipleOf(0.01),
  note: z.string().trim().max(200).default(''),
});

const text = z.string().trim().max(200).default('');
const money = z.number().finite().min(0).max(9999999999.99).multipleOf(0.01).nullable().default(null);
const salaryValue = z.union([z.number().finite().min(0).max(9999999999.99).multipleOf(0.01), z.string().max(200)]).nullable();
// 区间含下限、不含上限；100% 全勤通过 100–100 单独配置。
const attendanceRate = z.number().finite().min(0).max(100).multipleOf(0.01);
const attendanceRule = z.object({
  minRate: attendanceRate,
  maxRate: attendanceRate,
  adjustment: z.number().finite().min(-9999999999.99).max(9999999999.99).multipleOf(0.01),
}).refine(rule => rule.minRate < rule.maxRate || (rule.minRate === 100 && rule.maxRate === 100), '出勤率区间无效');
export const attendanceRulesSchema = z.array(attendanceRule).max(30).superRefine((rules, ctx) => {
  const sorted = [...rules].sort((a, b) => a.minRate - b.minRate || a.maxRate - b.maxRate);
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]; const current = sorted[index];
    if (previous.maxRate > current.minRate || (previous.minRate === 100 && current.minRate === 100)) {
      ctx.addIssue({ code: 'custom', message: '出勤率区间不能重叠' }); return;
    }
  }
});
// 全员规则按显示顺序保存：规则 1 为 100–100 全勤，之后每条上限等于上一条下限，最后一条下限为 0。
export const payrollAttendanceRulesSchema = z.array(attendanceRule).min(2, '至少保留全勤规则和一条区间规则').max(30).superRefine((rules, ctx) => {
  if (rules.length < 2) return;
  if (rules[0].minRate !== 100 || rules[0].maxRate !== 100) {
    ctx.addIssue({ code: 'custom', message: '规则 1 必须为全勤规则' }); return;
  }
  for (let index = 1; index < rules.length; index += 1) {
    const previous = rules[index - 1]; const current = rules[index];
    if (current.minRate === 100 && current.maxRate === 100) {
      ctx.addIssue({ code: 'custom', message: '只能设置一条全勤规则' }); return;
    }
    if (current.maxRate !== previous.minRate) {
      ctx.addIssue({ code: 'custom', message: `规则 ${index + 1} 的上限必须等于上一条规则的下限` }); return;
    }
    if (index < rules.length - 1 && current.minRate <= 0) {
      ctx.addIssue({ code: 'custom', message: '中间规则的下限必须大于 0' }); return;
    }
  }
  if (rules[rules.length - 1].minRate !== 0) {
    ctx.addIssue({ code: 'custom', message: '最后一条规则的下限必须为 0' });
  }
});
export const hrRecordSchemas = {
  profile: z.object({ address: text, emergencyContact: text, emergencyPhone: text, education: text }),
  contract: z.object({ number: z.string().trim().min(1, '请填写合同编号').max(200), startDate: z.string().date('请选择有效的合同开始日期'), endDate: z.string().date('请选择有效的合同结束日期'), note: text }).refine(value => value.endDate >= value.startDate, { path: ['endDate'], message: '合同结束日期不能早于开始日期' }),
  salary: z.object({ effectiveDate: text, base: money, allowance: money, performance: money, values: z.record(z.string().trim().min(1).max(60), salaryValue).optional(), modelVersion: z.number().int().positive().safe().optional(), attendanceRules: attendanceRulesSchema.optional(), note: text }),
};
