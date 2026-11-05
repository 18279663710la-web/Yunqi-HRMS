import { buildSalaryValues, salaryAmountFields, type SalaryFieldCategory, type SalaryModel, type AttendanceMetric } from './salaryModelService';
import { badRequest } from '../../shared/utils/errors';

export interface PayrollValue { name: string; value: number | string; category?: SalaryFieldCategory; type?: 'number' | 'text'; interfaceSource?: 'attendance'; attendanceMetric?: AttendanceMetric; attendancePeriod?: string }
export interface PayrollExtendedValue extends PayrollValue { category: SalaryFieldCategory }
export interface PayrollModelSnapshot {
  version: number;
  fixed: PayrollValue[];
  extended: PayrollExtendedValue[];
  fixedTotal: number;
  revision?: number;
  position?: string;
}

function checkValue(field: PayrollValue): void {
  if (field.type === 'text') {
    if (typeof field.value !== 'string' || field.value.length > 200 || (field.category && field.category !== 'info')) throw badRequest(`字段${field.name}的文本无效`);
    return;
  }
  if (typeof field.value !== 'number' || !Number.isFinite(field.value) || field.value < 0 || field.value > 9999999999.99 || Math.abs(field.value * 100 - Math.round(field.value * 100)) > 1e-7) throw badRequest(`字段${field.name}的数值无效`);
}

export function fixedSalarySnapshot(record: Record<string, unknown>, model: SalaryModel): PayrollModelSnapshot {
  const values = buildSalaryValues(record, model);
  const fixed: PayrollValue[] = salaryAmountFields(model).map(field => {
    const value = values[field.name] ?? (field.type === 'text' ? '' : 0);
    const item: PayrollValue = { name: field.name, value, ...(field.type === 'text' ? { type: 'text' as const } : {}), ...(field.category ? { category: field.category } : {}), ...(field.interfaceSource ? { interfaceSource: field.interfaceSource } : {}), ...(field.attendanceMetric ? { attendanceMetric: field.attendanceMetric } : {}) };
    checkValue(item); return item;
  });
  const cents = fixed.reduce((sum, field) => sum + (typeof field.value === 'number' && (field.category ?? 'income') === 'income' ? Math.round(field.value * 100) : 0), 0);
  if (cents > 999999999999) throw badRequest('固定薪资合计超出允许范围');
  return { version: model.version, fixed, fixedTotal: cents / 100, extended: model.extendedFields.map(field => ({ name: field.name, value: field.type === 'text' ? '' : 0, category: field.category ?? 'info', ...(field.type === 'text' ? { type: 'text' as const } : {}), ...(field.interfaceSource ? { interfaceSource: field.interfaceSource } : {}), ...(field.attendanceMetric ? { attendanceMetric: field.attendanceMetric } : {}) })) };
}

export function calculateExtendedSalary(snapshot: PayrollModelSnapshot) {
  let income = 0; let deductions = 0;
  for (const field of snapshot.fixed) {
    checkValue(field);
    if (field.category === 'deduction' && typeof field.value === 'number') deductions += Math.round(field.value * 100);
  }
  for (const field of snapshot.extended) {
    checkValue(field);
    if (field.category === 'income' && typeof field.value === 'number') income += Math.round(field.value * 100);
    if (field.category === 'deduction' && typeof field.value === 'number') deductions += Math.round(field.value * 100);
  }
  const gross = Math.round(snapshot.fixedTotal * 100) + income;
  if (gross > 999999999999 || deductions > gross) throw badRequest('工资合计超出范围或扣款超过应发金额');
  return { gross: gross / 100, deductions: deductions / 100, net: (gross - deductions) / 100 };
}
