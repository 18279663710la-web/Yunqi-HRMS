import type { OvertimePayrollConfig, OvertimePayrollRule } from '../../hr/api';

export type OvertimeRuleDraft = Omit<OvertimePayrollRule, 'hourlyRate'> & { hourlyRate: number | null };

export function defaultOvertimeRules(): OvertimeRuleDraft[] {
  return [{ minHours: 0, maxHours: null, hourlyRate: 0 }];
}

const isAmount = (value: number | null): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 9999999999.99 && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;
const isHours = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1000000 && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;

export function buildOvertimeConfig(calculation: 'range' | 'unit', rules: OvertimeRuleDraft[], hourlyRate: number | null): OvertimePayrollConfig {
  if (calculation === 'unit') {
    if (!isAmount(hourlyRate)) throw new Error('请输入有效的每小时金额，最多两位小数');
    return { calculation, hourlyRate };
  }
  if (!rules.length || rules.length > 30 || rules[0].minHours !== 0) throw new Error('加班区间须从 0 小时开始');
  const validated = rules.map((rule, index): OvertimePayrollRule => {
    if (!isAmount(rule.hourlyRate)) throw new Error(`请填写区间${index + 1}的有效每小时金额`);
    if (!isHours(rule.minHours) || (rule.maxHours !== null && !isHours(rule.maxHours))) throw new Error('加班时长无效，最多两位小数');
    const last = index === rules.length - 1;
    if (last ? rule.maxHours !== null : rule.maxHours === null || rule.maxHours <= rule.minHours || rule.maxHours !== rules[index + 1].minHours) throw new Error('加班区间须连续且最后一个区间无上限');
    return { minHours: rule.minHours, maxHours: rule.maxHours, hourlyRate: rule.hourlyRate };
  });
  return { calculation, rules: validated };
}
