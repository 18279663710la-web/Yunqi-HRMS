import { buildSalaryValues, salaryAmountFields, type SalaryFieldCategory, type SalaryModel, type AttendanceMetric, type SalaryCalculationRule } from './salaryModelService';
import { badRequest } from '../../shared/utils/errors';
import type { PayrollAttendanceValues } from '../attendance/payrollAttendanceSource';

export interface PayrollValue { name: string; value: number | string; category?: SalaryFieldCategory; type?: 'number' | 'text'; interfaceSource?: 'attendance'; attendanceMetric?: AttendanceMetric; calculationRule?: SalaryCalculationRule; attendanceEmployeeNo?: string; attendancePeriod?: string; attendanceCalculation?: PayrollAttendanceValues['attendanceCalculation']; overtimeCalculation?: PayrollAttendanceValues['overtimeCalculation'] }
export interface PayrollExtendedValue extends PayrollValue { category: SalaryFieldCategory }
export interface PayrollModelSnapshot {
  version: number;
  fixed: PayrollValue[];
  extended: PayrollExtendedValue[];
  fixedTotal: number;
  manualDeduction?: number;
  revision?: number;
  position?: string;
}

function checkValue(field: PayrollValue): void {
  if (field.type === 'text') {
    if (typeof field.value !== 'string' || field.value.length > 200 || (field.category && field.category !== 'info')) throw badRequest(`字段${field.name}的文本无效`);
    return;
  }
  if (typeof field.value !== 'number' || !Number.isFinite(field.value) || field.value < (field.calculationRule === 'attendance' ? -9999999999.99 : 0) || field.value > 9999999999.99 || Math.abs(field.value * 100 - Math.round(field.value * 100)) > 1e-7) throw badRequest(`字段${field.name}的数值无效`);
}

export function calculateFixedIncome(fixed: PayrollValue[]): number {
  const cents = fixed.reduce((sum, field) => {
    checkValue(field);
    return sum + (typeof field.value === 'number' && (field.category ?? 'income') === 'income' ? Math.round(field.value * 100) : 0);
  }, 0);
  if (cents > 999999999999) throw badRequest('固定薪资合计超出允许范围');
  return cents / 100;
}

export function fixedSalarySnapshot(record: Record<string, unknown>, model: SalaryModel): PayrollModelSnapshot {
  const values = buildSalaryValues(record, model);
  const fixed: PayrollValue[] = salaryAmountFields(model).map(field => {
    const value = values[field.name] ?? (field.type === 'text' ? '' : 0);
    const item: PayrollValue = { name: field.name, value, ...(field.type === 'text' ? { type: 'text' as const } : {}), ...(field.category ? { category: field.category } : {}), ...(field.interfaceSource ? { interfaceSource: field.interfaceSource } : {}), ...(field.attendanceMetric ? { attendanceMetric: field.attendanceMetric } : {}), ...(field.calculationRule ? { calculationRule: field.calculationRule } : {}) };
    checkValue(item); return item;
  });
  return { version: model.version, fixed, fixedTotal: calculateFixedIncome(fixed), manualDeduction: 0, extended: model.extendedFields.map(field => ({ name: field.name, value: field.type === 'text' ? '' : 0, category: field.category ?? 'info', ...(field.type === 'text' ? { type: 'text' as const } : {}), ...(field.interfaceSource ? { interfaceSource: field.interfaceSource } : {}), ...(field.attendanceMetric ? { attendanceMetric: field.attendanceMetric } : {}), ...(field.calculationRule ? { calculationRule: field.calculationRule } : {}) })) };
}

export function calculateExtendedSalary(snapshot: PayrollModelSnapshot) {
  let income = 0; let modelDeductions = 0;
  for (const field of snapshot.fixed) {
    checkValue(field);
    if (field.category === 'deduction' && typeof field.value === 'number') modelDeductions += Math.round(field.value * 100);
  }
  for (const field of snapshot.extended) {
    checkValue(field);
    if (field.category === 'income' && typeof field.value === 'number') income += Math.round(field.value * 100);
    if (field.category === 'deduction' && typeof field.value === 'number') modelDeductions += Math.round(field.value * 100);
  }
  const manualDeduction = snapshot.manualDeduction ?? 0;
  if (!Number.isFinite(manualDeduction) || manualDeduction < 0 || manualDeduction > 9999999999.99 || Math.abs(manualDeduction * 100 - Math.round(manualDeduction * 100)) > 1e-7) throw badRequest('扣除金额无效');
  const deductions = Math.round(manualDeduction * 100);
  const gross = Math.round(snapshot.fixedTotal * 100) + income - modelDeductions;
  if (gross < 0 || gross > 999999999999 || deductions > gross) throw badRequest('工资合计超出范围或扣款超过应发金额');
  return { gross: gross / 100, deductions: deductions / 100, net: (gross - deductions) / 100 };
}
