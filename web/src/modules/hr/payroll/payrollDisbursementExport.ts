import type { DisbursementState, PayrollBatch, PayrollBatchItem, SalaryComponentModel } from '../api';
import { buildPayrollExportData, type PayrollExportData } from './payrollExportData';

export function buildDisbursementExportData(batch: PayrollBatch, items: PayrollBatchItem[], model: SalaryComponentModel, disbursement: DisbursementState): PayrollExportData {
  const base = buildPayrollExportData(batch, items, model);
  const indexed = new Map(disbursement.rows.map(row => [row.itemId, row]));
  const rows = base.rows.map((row, index) => {
    const state = indexed.get(items[index].id);
    if (!state) throw new Error('工资发放数据不完整，请刷新后重试');
    return [...row.slice(0, -1), ...disbursement.fields.map(field => state.values.find(value => value.fieldId === field.id)?.value ?? 0), row[row.length - 1], Number(state.net)];
  });
  const net = items.reduce((sum, item) => sum + Math.round(Number(indexed.get(item.id)?.net ?? 0) * 100), 0) / 100;
  let number = Math.max(0, ...base.columnNumbers.map(value => Number(value) || 0));
  return { ...base, alignTotalHeaders: true, filename: `工资发放_${batch.month}_批次${batch.id}`, headers: [...base.headers.slice(0, -1), ...disbursement.fields.map(field => field.name), '应发', '实发'], columnNumbers: [...base.columnNumbers.slice(0, -1), ...disbursement.fields.map(() => String(++number)), '', ''], rows, totals: [base.totals[0], net], totalColumnIndexes: [base.headers.length - 1 + disbursement.fields.length, base.headers.length + disbursement.fields.length] };
}
