import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { badRequest } from '../../shared/utils/errors';
import { readPayrollAttendance } from '../attendance/payrollAttendanceSource';
import type { AttendanceMetric, SalaryModel } from './salaryModelService';
import type { PayrollModelSnapshot } from './payrollModelCalculation';

type ModelEmployee = { employeeId: string; employeeNo: string; name: string; modelSnapshot: PayrollModelSnapshot };

/** 按模型配置解析员工号和工资月份，再将接口取值与规则结果写入明细快照。 */
export async function applyModelAttendance(conn: PoolConnection, model: SalaryModel, employees: ModelEmployee[], month: string): Promise<void> {
  const fields = [...model.fixedFields, ...model.extendedFields];
  const ruleFor = (field: { attendanceMetric?: AttendanceMetric; calculationRule?: string }) => field.attendanceMetric === 'overtimePay' ? 'overtime' : field.calculationRule ?? 'direct';
  if (fields.some(field => field.attendanceMetric && (field.interfaceSource !== 'attendance' || field.type !== 'number' || field.category !== (ruleFor(field) === 'direct' ? 'info' : 'income') || (ruleFor(field) === 'attendance' && field.attendanceMetric !== 'presentDays') || (ruleFor(field) === 'overtime' && !['overtimeHours', 'overtimePay'].includes(field.attendanceMetric)))) || ['attendance', 'overtime'].some(rule => fields.filter(field => field.attendanceMetric && ruleFor(field) === rule).length > 1)) throw badRequest('考勤字段配置无效，请检查薪资构成模型');
  const metrics = new Set<AttendanceMetric>(fields.flatMap(field => !field.attendanceMetric ? [] : [ruleFor(field) === 'overtime' ? 'overtimePay' : field.attendanceMetric]));
  if (!employees.length || !metrics.size) return;
  const ids = employees.map(employee => employee.employeeId);
  const placeholders = ids.map(() => '?').join(',');
  const [matches] = await conn.query<RowDataPacket[]>(`SELECT e.id AS requestedId, e.employee_no AS employeeNo, source.id AS sourceId FROM employees e JOIN employees source ON source.employee_no = e.employee_no WHERE e.id IN (${placeholders}) ORDER BY e.id, source.id`, ids);
  const byEmployee = new Map<string, RowDataPacket[]>();
  for (const row of matches) {
    const id = String(row.requestedId);
    const group = byEmployee.get(id) ?? [];
    group.push(row);
    byEmployee.set(id, group);
  }
  const resolved = new Map<string, string>();
  for (const employee of employees) {
    const rows = byEmployee.get(employee.employeeId) ?? [];
    if (!employee.employeeNo.trim() || rows.length !== 1 || String(rows[0].employeeNo) !== employee.employeeNo || String(rows[0].sourceId) !== employee.employeeId) throw badRequest(`员工“${employee.name}”的员工号为空或不唯一，无法获取考勤数据`);
    resolved.set(employee.employeeId, String(rows[0].sourceId));
  }
  const attendance = await readPayrollAttendance(conn, employees.map(employee => ({ id: resolved.get(employee.employeeId)!, name: `${employee.name}（${employee.employeeNo}）` })), month, metrics, { attendanceRule: fields.some(field => ruleFor(field) === 'attendance') });
  for (const employee of employees) {
    const values = attendance.get(resolved.get(employee.employeeId)!);
    for (const field of [...employee.modelSnapshot.fixed, ...employee.modelSnapshot.extended]) {
      if (!field.attendanceMetric) continue;
      const rule = ruleFor(field);
      const value = rule === 'attendance' ? values?.attendanceAdjustment : values?.[rule === 'overtime' ? 'overtimePay' : field.attendanceMetric];
      if (value === undefined) throw badRequest(`未能获取员工“${employee.name}”的考勤数据`);
      field.value = value;
      field.attendanceEmployeeNo = employee.employeeNo;
      field.attendancePeriod = month;
      if (rule === 'attendance') field.attendanceCalculation = values?.attendanceCalculation;
      if (rule === 'overtime') field.overtimeCalculation = values?.overtimeCalculation;
    }
  }
}
