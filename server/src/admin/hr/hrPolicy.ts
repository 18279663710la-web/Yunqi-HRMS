import { z } from 'zod';

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
export const hrRecordSchemas = {
  profile: z.object({ address: text, emergencyContact: text, emergencyPhone: text, education: text }),
  contract: z.object({ number: z.string().trim().min(1, '请填写合同编号').max(200), startDate: z.string().date('请选择有效的合同开始日期'), endDate: z.string().date('请选择有效的合同结束日期'), note: text }).refine(value => value.endDate >= value.startDate, { path: ['endDate'], message: '合同结束日期不能早于开始日期' }),
  salary: z.object({ effectiveDate: text, base: money, allowance: money, performance: money, values: z.record(z.string().trim().min(1).max(60), salaryValue).optional(), modelVersion: z.number().int().positive().safe().optional(), attendanceRules: attendanceRulesSchema.optional(), note: text }),
};
