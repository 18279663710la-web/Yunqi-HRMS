import type { SalaryCalculationRule, SalaryModelField } from '../../hr/api';

export function applyAttendanceInterface(metric: SalaryModelField['attendanceMetric'], rule: SalaryCalculationRule = 'direct'): Partial<SalaryModelField> {
  if (!metric) throw new Error('请选择考勤数据');
  if ((rule === 'attendance' && metric !== 'presentDays') || (rule === 'overtime' && metric !== 'overtimeHours') || metric === 'overtimePay') throw new Error('考勤数据与计算规则不匹配');
  return { interfaceSource: 'attendance', attendanceMetric: metric, calculationRule: rule, type: 'number', category: rule === 'direct' ? 'info' : 'income' };
}

export function clearSalaryInterface(): Partial<SalaryModelField> {
  return { interfaceSource: 'none', attendanceMetric: undefined, calculationRule: undefined };
}
