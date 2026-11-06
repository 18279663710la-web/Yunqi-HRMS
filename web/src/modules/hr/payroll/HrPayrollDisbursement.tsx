import { useEffect, useState } from 'react';
import { Alert, App, Button, DatePicker, Modal, Spin, Table } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { SubModuleHeader } from '../../../components/SubModuleHeader';
import { useWorkspaceActive } from '../../../layout/WorkspaceContext';
import { getPayrollBatches, getPayrollBatchItems, getPayrollRecords, getSalaryComponentModel, type PayrollBatch, type PayrollBatchItem, type PayrollRecord, type SalaryComponentModel } from '../api';
import { PayrollDisbursementBatch } from './PayrollDisbursementBatch';

export function HrPayrollDisbursement() {
  const { message } = App.useApp();
  const workspaceActive = useWorkspaceActive();
  const [month, setMonth] = useState<Dayjs | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<PayrollBatch>();
  const [batches, setBatches] = useState<PayrollBatch[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<{ batchId: number; items: PayrollBatchItem[]; model: SalaryComponentModel }>();
  const [detailError, setDetailError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const selectedMonth = month?.format('YYYY-MM');

  useEffect(() => {
    if (!workspaceActive || !batchOpen || !selectedMonth) return;
    let active = true;
    setLoading(true);
    setBatches([]);
    getPayrollBatches(selectedMonth).then(rows => {
      if (active) setBatches(rows.filter(batch => batch.month === selectedMonth && batch.status === 'reviewed'));
    }).catch((error: Error) => { if (active) message.error(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceActive, batchOpen, selectedMonth]);

  useEffect(() => {
    if (!workspaceActive || !selectedBatch) return;
    let active = true;
    setDetailLoading(true);
    setDetailError('');
    Promise.all([getPayrollBatchItems(selectedBatch.id), getSalaryComponentModel()]).then(([items, model]) => {
      if (active) setDetail({ batchId: selectedBatch.id, items, model });
    }).catch((error: Error) => { if (active) { setDetail(undefined); setDetailError(error.message || '工资明细加载失败'); } }).finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [workspaceActive, selectedBatch, retry]);

  return <section className="payroll-batches-workspace" aria-label="工资发放">
    <div className="salary-model-entries payroll-disbursement-toolbar">
      <DatePicker picker="month" aria-label="工资发放月份" placeholder="选择月份" variant="borderless" value={month} onChange={value => { setMonth(value); setSelectedBatch(undefined); setDetail(undefined); setDetailError(''); setBatchOpen(false); }} />
      <button type="button" className="salary-model-entry" disabled={!selectedMonth} onClick={() => setBatchOpen(true)}>选择批次</button>
    </div>
    {selectedBatch && (detailError ? <Alert type="error" message={detailError} action={<Button size="small" onClick={() => setRetry(value => value + 1)}>重试</Button>} /> : detail && detail.batchId === selectedBatch.id && !detailLoading ? <PayrollDisbursementBatch batch={selectedBatch} items={detail.items} model={detail.model} /> : <Spin />)}
    <Modal title="选择工资批次" open={batchOpen} onCancel={() => setBatchOpen(false)} footer={<Button onClick={() => setBatchOpen(false)}>关闭</Button>} width={600}>
      <Table rowKey="id" dataSource={batches} loading={loading} pagination={{ pageSize: 10 }} size="small" columns={[
        { title: '工资月份', dataIndex: 'month' },
        { title: '状态', render: () => '已复核' },
        { title: '操作', render: (_: unknown, batch: PayrollBatch) => <Button type="link" onClick={() => { setDetail(undefined); setDetailError(''); setSelectedBatch(batch); setBatchOpen(false); }}>选择</Button> },
      ]} />
    </Modal>
  </section>;
}

export function HrPayrollRecords() {
  const { message } = App.useApp();
  const workspaceActive = useWorkspaceActive();
  const [rows, setRows] = useState<PayrollRecord[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!workspaceActive) return;
    let active = true;
    setLoading(true);
    getPayrollRecords().then(records => { if (active) setRows(records); }).catch((error: Error) => { if (active) message.error(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceActive]);
  return <>
    <SubModuleHeader title="工资发放记录" />
    <Table rowKey="id" loading={loading} dataSource={rows} pagination={{ pageSize: 10 }} scroll={{ x: 700 }} columns={[
      { title: '类型', render: (_: unknown, r: PayrollRecord) => r.batchId == null ? '员工' : '工资批次' },
      { title: '员工', render: (_: unknown, r: PayrollRecord) => `${r.name} · ${r.employeeNo}` },
      { title: '工资月份', dataIndex: 'month' }, { title: '实发金额', dataIndex: 'amount', render: (n: string) => `¥${Number(n).toFixed(2)}` },
      { title: '备注', dataIndex: 'note', render: (v: string) => v || '—' }, { title: '登记时间', dataIndex: 'createdAt', render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
    ]} />
  </>;
}
