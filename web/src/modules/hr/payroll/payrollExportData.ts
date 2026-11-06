import type { PayrollBatch, PayrollBatchItem, SalaryComponentModel } from '../api';
import { payrollFieldNames } from './payrollFieldOrder';

export type PayrollExportCell = string | number;
export interface PayrollExportData {
  title: string;
  periodLabel: string;
  columnNumbers: string[];
  filename: string;
  headers: string[];
  rows: PayrollExportCell[][];
  totals: [number];
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
    }), Number(item.gross)];
  });
  const gross = items.reduce((total, item) => total + Math.round(Number(item.gross) * 100), 0) / 100;
  const [year, month] = batch.month.split('-');
  let number = 0;
  const columnNumbers = fields.map(name => ['姓名', '员工号', '职务'].includes(name) ? '' : String(++number));
  return { title: '工资表', periodLabel: `${year}（${Number(month)}）月份应发工资奖金补贴及其他`, columnNumbers: [...columnNumbers, ''], filename: `工资批次_${batch.month}_${status}`, headers: [...fields, '应发'], rows, totals: [gross] };
}
