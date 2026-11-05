import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { transaction } from '../../shared/db/pool';
import { badRequest, notFound } from '../../shared/utils/errors';
import { dateKey, parseDateKey } from '../../shared/utils/datetime';
import { readSalaryModel, type SalaryModel } from './salaryModelService';
import { readPayrollAttendance } from '../attendance/payrollAttendanceSource';
import type { AttendanceMetric } from './salaryModelService';
import { calculateExtendedSalary, fixedSalarySnapshot, type PayrollModelSnapshot } from './payrollModelCalculation';

export interface AutoPayrollCandidate {
  employeeId: string; name: string; employeeNo: string; position: string;
  baseGross: number; gross: number; deductions: number; net: number;
  modelSnapshot: PayrollModelSnapshot;
}
export interface AutoPayrollTotals { baseGross: number; gross: number; deductions: number; net: number }
export interface AutoPayrollPreview { month: string; candidates: AutoPayrollCandidate[]; existingCount: number; totals: AutoPayrollTotals }
export interface AutoPayrollAddResult { addedCount: number; skippedExisting: number; totals: AutoPayrollTotals }

const decode = (value: unknown) => typeof value === 'string' ? JSON.parse(value) : value;
const isStrictDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && dateKey(parseDateKey(value)) === value;

async function readBatch(conn: PoolConnection, batchId: number, lock: boolean): Promise<{ month: string }> {
  const [rows] = await conn.query<RowDataPacket[]>(`SELECT status, payroll_month AS month FROM hr_payroll_batches WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [batchId]);
  if (!rows.length) throw notFound('工资批次不存在');
  if (rows[0].status !== 'draft') throw badRequest('已复核的批次不能添加工资明细');
  return { month: String(rows[0].month) };
}

async function collectCandidates(conn: PoolConnection, batchId: number, model: SalaryModel, month: string, employeeIds?: string[]): Promise<{ candidates: AutoPayrollCandidate[]; existingCount: number }> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT e.id, e.name, e.employee_no AS employeeNo, e.position, o.archived_at AS archivedAt, c.data_json AS contract, s.data_json AS salary
       FROM employees e
       LEFT JOIN hr_self_onboarding o ON o.employee_id = e.id
       LEFT JOIN hr_employee_records c ON c.employee_id = e.id AND c.section = 'contract'
       JOIN hr_employee_records s ON s.employee_id = e.id AND s.section = 'salary'
      ORDER BY e.pinyin, e.id`
  );
  const [existingRows] = await conn.query<RowDataPacket[]>('SELECT employee_id AS employeeId FROM hr_payroll_batch_items WHERE batch_id = ?', [batchId]);
  const existing = new Set(existingRows.map(row => String(row.employeeId)));
  const selected = employeeIds ? new Set(employeeIds) : null;
  let existingCount = 0;
  const candidates: AutoPayrollCandidate[] = [];
  for (const row of rows) {
    if (selected && !selected.has(String(row.id))) continue;
    const contract = decode(row.contract) as Record<string, unknown> | null;
    const salary = decode(row.salary) as Record<string, unknown> | null;
    if (!salary || !isStrictDate(salary.effectiveDate)) continue;
    if (!selected && (!row.archivedAt || !contract || typeof contract.number !== 'string' || !contract.number.trim() || !isStrictDate(contract.startDate) || !isStrictDate(contract.endDate) || contract.startDate > contract.endDate)) continue;
    if (existing.has(String(row.id))) { existingCount++; continue; }
    const modelSnapshot = fixedSalarySnapshot(salary, model);
    modelSnapshot.position = String(row.position ?? '');
    modelSnapshot.revision = 0;
    const totals = calculateExtendedSalary(modelSnapshot);
    candidates.push({ employeeId: String(row.id), name: String(row.name), employeeNo: String(row.employeeNo), position: String(row.position ?? ''), baseGross: modelSnapshot.fixedTotal, ...totals, modelSnapshot });
  }
  if ([...model.fixedFields, ...model.extendedFields].some(field => field.attendanceMetric && (field.interfaceSource !== 'attendance' || field.type !== 'number' || field.category !== 'info'))) throw badRequest('考勤字段配置无效，请检查薪资构成模型');
  const metrics = new Set<AttendanceMetric>([...model.fixedFields, ...model.extendedFields].flatMap(field => field.attendanceMetric ? [field.attendanceMetric] : []));
  const attendance = await readPayrollAttendance(conn, candidates.map(candidate => ({ id: candidate.employeeId, name: `${candidate.name}（${candidate.employeeNo}）` })), month, metrics);
  for (const candidate of candidates) {
    for (const field of [...candidate.modelSnapshot.fixed, ...candidate.modelSnapshot.extended]) {
      if (!field.attendanceMetric) continue;
      const value = attendance.get(candidate.employeeId)?.[field.attendanceMetric];
      if (value === undefined) throw badRequest(`未能获取员工“${candidate.name}”的考勤数据`);
      field.value = value;
      field.attendancePeriod = month;
    }
  }
  return { candidates, existingCount };
}
function sumTotals(candidates: AutoPayrollCandidate[]): AutoPayrollTotals {
  const sum = (key: 'baseGross' | 'gross' | 'deductions' | 'net') => candidates.reduce((total, candidate) => total + Math.round(candidate[key] * 100), 0) / 100;
  return { baseGross: sum('baseGross'), gross: sum('gross'), deductions: sum('deductions'), net: sum('net') };
}
export async function previewAutoPayrollItems(batchId: number): Promise<AutoPayrollPreview> {
  return transaction(async conn => {
    const model = await readSalaryModel(conn);
    const batch = await readBatch(conn, batchId, false);
    const { candidates, existingCount } = await collectCandidates(conn, batchId, model, batch.month);
    return { month: batch.month, candidates, existingCount, totals: sumTotals(candidates) };
  });
}
export async function addAutoPayrollItems(batchId: number, employeeIds?: string[]): Promise<AutoPayrollAddResult> {
  return transaction(async conn => {
    const model = await readSalaryModel(conn, true);
    const batch = await readBatch(conn, batchId, true);
    const { candidates, existingCount } = await collectCandidates(conn, batchId, model, batch.month, employeeIds);
    if (employeeIds && candidates.length + existingCount !== new Set(employeeIds).size) throw badRequest('员工没有有效的定薪信息');
    const added: AutoPayrollCandidate[] = [];
    for (const candidate of candidates) {
      const [result] = await conn.execute<ResultSetHeader>(
        `INSERT INTO hr_payroll_batch_items (batch_id, employee_id, base_gross, model_snapshot, gross, deductions, net, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, '') ON DUPLICATE KEY UPDATE id = id`,
        [batchId, candidate.employeeId, candidate.baseGross, JSON.stringify(candidate.modelSnapshot), candidate.gross, candidate.deductions, candidate.net]
      );
      if (result.affectedRows) added.push(candidate);
    }
    return { addedCount: added.length, skippedExisting: existingCount + candidates.length - added.length, totals: sumTotals(added) };
  });
}
