import type { SalaryModelField } from '../../hr/api';

export function applyAttendanceInterface(metric: SalaryModelField['attendanceMetric']): Partial<SalaryModelField> {
  if (!metric) throw new Error('请选择考勤数据');
  return { interfaceSource: 'attendance', attendanceMetric: metric, type: 'number', category: metric === 'overtimePay' ? 'income' : 'info' };
}

export function clearSalaryInterface(): Partial<SalaryModelField> {
  return { interfaceSource: 'none', attendanceMetric: undefined };
}
