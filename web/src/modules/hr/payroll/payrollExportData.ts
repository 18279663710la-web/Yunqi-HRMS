import type { PayrollBatch, PayrollBatchItem, SalaryComponentModel } from '../api';
import { payrollFieldNames } from './payrollFieldOrder';

export type PayrollExportCell = string | number;
export interface PayrollExportData {
  title: string;
  filename: string;
  headers: string[];
  rows: PayrollExportCell[][];
  totals: [number, number, number];
}

/** 使用当前页面显示的模型顺序和已保存的明细快照。 */
export function buildPayrollExportData(batch: PayrollBatch, items: PayrollBatchItem[], model?: SalaryComponentModel): PayrollExportData {
  const fields = payrollFieldNames(model, items.map(item => item.modelSnapshot));
  const status = batch.status === 'draft' ? '草稿' : '已复核';
  const rows = items.map(item => {
    const values = new Map([...(item.modelSnapshot?.fixed ?? []), ...(item.modelSnapshot?.extended ?? [])].map(field => [field.name, field.value]));
    return [...fields.map(name => {
      if (name === '姓名') return item.name;
      if (name === '员工号') return item.employeeNo;
      if (name === '职务') return item.modelSnapshot?.position ?? item.position ?? '—';
      return values.get(name) || (values.get(name) === 0 ? 0 : '—');
    }), Number(item.gross), Number(item.deductions), Number(item.net)];
  });
  const sum = (key: 'gross' | 'deductions' | 'net') => items.reduce((total, item) => total + Math.round(Number(item[key]) * 100), 0) / 100;
  return { title: `${batch.month} 工资批次 · ${status}`, filename: `工资批次_${batch.month}_${status}`, headers: [...fields, '应发', '扣除', '实发'], rows, totals: [sum('gross'), sum('deductions'), sum('net')] };
}

/** 宽表拆页时保留每页员工身份，其余列依原顺序出现一次。 */
export function splitPayrollColumns(headers: string[], maxColumns: number): number[][] {
  if (headers.length <= maxColumns) return [headers.map((_, index) => index)];
  const identity = headers.flatMap((name, index) => name === '姓名' || name === '员工号' ? [index] : []);
  if (maxColumns <= identity.length) throw new Error('PDF 页面列数不足');
  const chunks = [headers.slice(0, maxColumns).map((_, index) => index)];
  const remaining = headers.map((_, index) => index).slice(maxColumns).filter(index => !identity.includes(index));
  for (let i = 0; i < remaining.length; i += maxColumns - identity.length) chunks.push([...identity, ...remaining.slice(i, i + maxColumns - identity.length)]);
  return chunks;
}
