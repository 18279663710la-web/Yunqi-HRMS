import type { PayrollModelSnapshot } from '../../hr/api';

/** 按工资模型字段用途计算应发，并扣除独立手填金额。 */
export function calculateSalaryTotals(snapshot: PayrollModelSnapshot, values: ReadonlyMap<string, number | string>, manualDeduction: number) {
  let gross = Math.round(snapshot.fixedTotal * 100);
  const deductions = Math.round(manualDeduction * 100);
  for (const field of snapshot.fixed) if (field.category === 'deduction' && typeof field.value === 'number') gross -= Math.round(field.value * 100);
  for (const field of snapshot.extended) {
    const value = values.get(field.name);
    if (typeof value !== 'number') continue;
    if (field.category === 'income') gross += Math.round(value * 100);
    if (field.category === 'deduction') gross -= Math.round(value * 100);
  }
  if (gross < 0 || gross > 999999999999 || deductions > gross) return undefined;
  return { gross: gross / 100, deductions: deductions / 100, net: (gross - deductions) / 100 };
}
