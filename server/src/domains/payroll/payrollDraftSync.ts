import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { transaction } from '../../shared/db/pool';
import { badRequest } from '../../shared/utils/errors';
import { calculateExtendedSalary, type PayrollModelSnapshot, type PayrollValue } from './payrollModelCalculation';
import { readSalaryModel, salaryAmountFields, type SalaryModel, type SalaryModelField } from './salaryModelService';

export function synchronizeDraftSnapshot(snapshot: PayrollModelSnapshot, model: SalaryModel): PayrollModelSnapshot | undefined {
  let changed = snapshot.manualDeduction === undefined;
  const update = <T extends PayrollValue>(fields: T[], modelFields: SalaryModelField[], defaultCategory: 'income' | 'info'): T[] => fields.map(field => {
    const current = modelFields.find(candidate => candidate.name === field.name);
    if (!current) return field;
    const category = current.category ?? defaultCategory;
    if ((field.category ?? defaultCategory) === category) return field;
    if (field.type === 'text' && category !== 'info') throw badRequest(`草稿字段“${field.name}”为文本，不能同步为收入或扣款`);
    changed = true;
    return { ...field, category };
  });
  const fixed = update(snapshot.fixed, salaryAmountFields(model), 'income');
  const extended = update(snapshot.extended, model.extendedFields, 'info');
  if (!changed) return undefined;
  const fixedTotal = fixed.reduce((sum, field) => sum + (typeof field.value === 'number' && (field.category ?? 'income') === 'income' ? Math.round(field.value * 100) : 0), 0) / 100;
  return { ...snapshot, fixed, extended, fixedTotal, manualDeduction: snapshot.manualDeduction ?? 0, revision: (snapshot.revision ?? 0) + 1 };
}

export async function syncDraftsWithModel(conn: PoolConnection, model: SalaryModel, batchId?: number): Promise<void> {
  const [batches] = await conn.query<RowDataPacket[]>(`SELECT id FROM hr_payroll_batches WHERE status = 'draft'${batchId === undefined ? '' : ' AND id = ?'} ORDER BY id FOR UPDATE`, batchId === undefined ? [] : [batchId]);
  for (const batch of batches) {
    const [items] = await conn.query<RowDataPacket[]>('SELECT id, model_snapshot FROM hr_payroll_batch_items WHERE batch_id = ? ORDER BY id FOR UPDATE', [batch.id]);
    for (const item of items) {
      if (!item.model_snapshot) continue;
      const snapshot = typeof item.model_snapshot === 'string' ? JSON.parse(item.model_snapshot) : item.model_snapshot;
      const updated = synchronizeDraftSnapshot(snapshot, model);
      if (!updated) continue;
      let totals;
      try { totals = calculateExtendedSalary(updated); }
      catch { throw badRequest(`工资草稿批次 ${batch.id} 同步字段用途后金额无效，请先调整该批次明细`); }
      await conn.execute('UPDATE hr_payroll_batch_items SET model_snapshot = ?, gross = ?, deductions = ?, net = ? WHERE id = ?', [JSON.stringify(updated), totals.gross, totals.deductions, totals.net, item.id]);
    }
  }
}

export async function syncDraftBatch(batchId: number): Promise<void> {
  await transaction(async conn => syncDraftsWithModel(conn, await readSalaryModel(conn, true), batchId));
}
