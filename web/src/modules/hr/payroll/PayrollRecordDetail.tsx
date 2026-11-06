import { useEffect, useState } from 'react';
import { Alert, Button, Spin } from 'antd';
import { useParams } from 'react-router-dom';
import { useWorkspaceActive } from '../../../layout/WorkspaceContext';
import { getDisbursementRecord, type PayrollDisbursementSnapshot } from '../api';
import { buildDisbursementExportData } from './payrollDisbursementExport';
import type { PayrollExportCell, PayrollExportData } from './payrollExportData';

const format = (value: PayrollExportCell) => typeof value === 'number' ? value.toFixed(2) : value;

export function PayrollRecordSheet({ data }: { data: PayrollExportData }) {
  const last = data.headers.length - 1;
  const indexes = data.totalColumnIndexes ?? [last];
  const labelColumns = Math.min(3, last);
  const summary: Array<{ key: number; span: number; value: string | number }> = [];
  for (let index = labelColumns; index < data.headers.length;) {
    const totalIndex = indexes.indexOf(index);
    if (totalIndex >= 0) { summary.push({ key: index, span: 1, value: data.totals[totalIndex] }); index++; }
    else {
      let end = index + 1;
      while (end < data.headers.length && !indexes.includes(end)) end++;
      summary.push({ key: index, span: end - index, value: '' }); index = end;
    }
  }
  return <div className="payroll-record-sheet-scroll" role="region" aria-label="工资发放记录表格滚动" tabIndex={0}>
    <table className="payroll-record-sheet">
      <caption>{data.title}</caption>
      <thead>
        <tr><th colSpan={last}>{data.periodLabel}</th><th rowSpan={3}>{data.headers[last]}</th></tr>
        <tr>{data.headers.slice(0, last).map((name, index) => <th key={index} rowSpan={data.columnNumbers[index] ? 1 : 2}>{name}</th>)}</tr>
        <tr>{data.headers.slice(0, last).map((_, index) => data.columnNumbers[index] ? <th key={index}>{data.columnNumbers[index]}</th> : null)}</tr>
      </thead>
      <tbody>
        {data.rows.map((row, index) => <tr key={index}>{row.map((value, column) => <td key={column}>{format(value)}</td>)}</tr>)}
        <tr><td colSpan={labelColumns}><strong>本批次合计</strong></td>{summary.map(cell => <td key={cell.key} colSpan={cell.span}><strong>{format(cell.value)}</strong></td>)}</tr>
      </tbody>
    </table>
  </div>;
}

export function PayrollRecordDetail() {
  const { id, month } = useParams();
  const active = useWorkspaceActive();
  const [record, setRecord] = useState<PayrollDisbursementSnapshot>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!active) return;
    let live = true;
    setError('');
    getDisbursementRecord(Number(id)).then(value => {
      if (!live) return;
      if (value.batch.month !== month) { setError('工资月份与发放记录不匹配'); return; }
      setRecord(value);
    }).catch((reason: Error) => { if (live) setError(reason.message); });
    return () => { live = false; };
  }, [active, id, month, retry]);
  if (error) return <Alert type="error" message={error} action={<Button size="small" onClick={() => setRetry(value => value + 1)}>重试</Button>} />;
  if (!record) return <Spin />;
  return <PayrollRecordSheet data={buildDisbursementExportData(record.batch, record.items, record.model, record.disbursement)} />;
}
