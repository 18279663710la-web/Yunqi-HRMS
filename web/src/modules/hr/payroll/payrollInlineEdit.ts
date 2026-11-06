import type { PayrollModelSnapshot } from '../api';
import { calculateSalaryTotals } from '../../models-formulas/salary/salaryCalculation';

export function parseManualDeduction(rawValue: string): number {
  const trimmed = rawValue.trim();
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(trimmed)) throw new Error('请输入非负数字，最多两位小数');
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value > 9999999999.99) throw new Error('金额超出允许范围');
  return value;
}

export function buildInlinePayrollUpdate(snapshot: PayrollModelSnapshot, fieldName: string, rawValue: string) {
  const field = snapshot.extended.find(item => item.name === fieldName);
  if (!field) throw new Error('只能编辑工资明细中的扩展字段');
  if (field.attendanceMetric) throw new Error('考勤系统字段不能手工修改');
  let value: string | number = rawValue;
  if (field.type === 'text') {
    if (rawValue.length > 200) throw new Error('最多输入 200 个字符');
  } else {
    value = parseManualDeduction(rawValue);
  }
  return { revision: snapshot.revision ?? 0, values: snapshot.extended.map(item => ({ name: item.name, value: item.name === fieldName ? value : item.value })) };
}

export function previewInlinePayrollTotals(snapshot: PayrollModelSnapshot, fieldName: string, rawValue: string, manual = false) {
  try {
    const values = new Map((manual ? snapshot.extended : buildInlinePayrollUpdate(snapshot, fieldName, rawValue).values).map(field => [field.name, field.value]));
    return calculateSalaryTotals(snapshot, values, manual ? parseManualDeduction(rawValue) : snapshot.manualDeduction ?? 0);
  } catch { return undefined; }
}
