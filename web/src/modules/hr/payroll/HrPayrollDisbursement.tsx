import { useEffect, useState } from 'react';
import { App, Button, DatePicker, Form, Input, InputNumber, Select, Table } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { SubModuleHeader } from '../../../components/SubModuleHeader';
import { useWorkspaceActive } from '../../../layout/WorkspaceContext';
import { addBatchPayrollRecords, addPayrollRecord, getPayrollBatches, getPayrollBatchItems, getPayrollRecords, type HrEmployee, type PayrollBatch, type PayrollRecord } from '../api';

export function HrPayrollDisbursement({ employees }: { employees: HrEmployee[] }) {
  const { message } = App.useApp();
  const workspaceActive = useWorkspaceActive();
  const [saving, setSaving] = useState(false);
  const [batches, setBatches] = useState<PayrollBatch[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<number>();
  const [form] = Form.useForm();
  const type = Form.useWatch('type', form) || 'employee';

  useEffect(() => {
    if (!workspaceActive) return;
    let active = true;
    getPayrollBatches().then(items => { if (active) setBatches(items.filter(item => item.status === 'reviewed')); }).catch((error: Error) => { if (active) message.error(error.message); });
    return () => { active = false; };
  }, [workspaceActive]);
  useEffect(() => {
    if (type !== 'batch' || !selectedBatch) { setBatchLoading(false); return; }
    let active = true; setBatchLoading(true);
    getPayrollBatchItems(selectedBatch).then(items => {
      if (!active) return;
      const batch = batches.find(item => item.id === selectedBatch);
      if (!batch || !items.length) { message.error('工资批次没有明细'); return; }
      const cents = items.reduce((sum, item) => sum + Math.round(Number(item.net) * 100), 0);
      form.setFieldsValue({ month: dayjs(`${batch.month}-01`), amount: cents / 100 });
    }).catch((error: Error) => { if (active) message.error(error.message); }).finally(() => { if (active) setBatchLoading(false); });
    return () => { active = false; };
  }, [type, selectedBatch, batches, form]);

  const submit = async (values: { type: 'employee' | 'batch'; batchId?: number; employeeId: string; month: Dayjs; amount: number; note?: string }) => {
    setSaving(true);
    try {
      if (values.type === 'batch') await addBatchPayrollRecords(values.batchId!, values.note || '');
      else await addPayrollRecord({ employeeId: values.employeeId, month: values.month.format('YYYY-MM'), amount: values.amount, note: values.note || '' });
      form.resetFields(); setSelectedBatch(undefined); message.success('工资发放记录已登记');
    } catch (error) { message.error((error as Error).message); }
    finally { setSaving(false); }
  };

  return <>
    <SubModuleHeader title="工资发放" extra={<Button type="primary" loading={saving} disabled={batchLoading} onClick={() => form.submit()}>登记发放</Button>} />
    <Form form={form} layout="vertical" onFinish={submit} initialValues={{ type: 'employee' }} style={{ maxWidth: 560 }}>
      <Form.Item name="type" label="类型" rules={[{ required: true }]}><Select options={[{ value: 'employee', label: '员工' }, { value: 'batch', label: '工资批次' }]} onChange={() => { setSelectedBatch(undefined); form.resetFields(['employeeId', 'batchId', 'month', 'amount']); }} /></Form.Item>
      {type === 'batch' ? <Form.Item name="batchId" label="工资批次" rules={[{ required: true, message: '请选择已复核的工资批次' }]}><Select placeholder="请选择已复核的工资批次" options={batches.map(batch => ({ value: batch.id, label: `${batch.month} · 已复核` }))} onChange={value => { form.resetFields(['month', 'amount']); setSelectedBatch(value); }} /></Form.Item> : <Form.Item name="employeeId" label="员工" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={employees.map(e => ({ value: e.id, label: `${e.name} · ${e.employeeNo} · ${e.position}${e.employmentStatus === 'departed' ? ' · 已离职' : ''}` }))} /></Form.Item>}
      <Form.Item name="month" label="工资月份" rules={[{ required: true }]}><DatePicker picker="month" disabled={type === 'batch'} style={{ width: '100%' }} /></Form.Item>
      <Form.Item name="amount" label={type === 'batch' ? '实发金额合计（元）' : '实发金额（元）'} rules={[{ required: true }]}><InputNumber min={0} max={type === 'employee' ? 9999999999.99 : undefined} precision={2} disabled={type === 'batch'} style={{ width: '100%' }} /></Form.Item>
      <Form.Item name="note" label="备注"><Input.TextArea maxLength={200} /></Form.Item>
    </Form>
  </>;
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
