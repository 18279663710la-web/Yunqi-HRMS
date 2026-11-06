import { useEffect, useState } from 'react';
import { Alert, App, Button, Checkbox, DatePicker, Form, Input, Modal, Select, Spin, Table } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { SubModuleHeader } from '../../../components/SubModuleHeader';
import { useWorkspaceActive } from '../../../layout/WorkspaceContext';
import { addDisbursementField, getDisbursement, getPayrollBatches, getPayrollBatchItems, getPayrollRecords, getSalaryComponentModel, type DisbursementFieldInput, type DisbursementState, type PayrollBatch, type PayrollBatchItem, type PayrollRecord, type SalaryComponentModel } from '../api';
import { PayrollDisbursementBatch } from './PayrollDisbursementBatch';

export function HrPayrollDisbursement() {
  const { message } = App.useApp();
  const workspaceActive = useWorkspaceActive();
  const [month, setMonth] = useState<Dayjs | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<PayrollBatch>();
  const [batches, setBatches] = useState<PayrollBatch[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<{ batchId: number; items: PayrollBatchItem[]; model: SalaryComponentModel; disbursement: DisbursementState }>();
  const [detailError, setDetailError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [fieldOpen, setFieldOpen] = useState(false);
  const [fieldSaving, setFieldSaving] = useState(false);
  const [editingBusy, setEditingBusy] = useState(false);
  const [form] = Form.useForm<DisbursementFieldInput>();
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
    if (!workspaceActive || !selectedBatch || editingBusy || fieldSaving) return;
    let active = true;
    setDetailLoading(true);
    setDetailError('');
    Promise.all([getPayrollBatchItems(selectedBatch.id), getSalaryComponentModel(), getDisbursement(selectedBatch.id)]).then(([items, model, disbursement]) => {
      if (active) setDetail({ batchId: selectedBatch.id, items, model, disbursement });
    }).catch((error: Error) => { if (active) { setDetail(undefined); setDetailError(error.message || '工资明细加载失败'); } }).finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [workspaceActive, selectedBatch, retry, editingBusy, fieldSaving]);

  const createField = async (input: DisbursementFieldInput) => {
    if (!selectedBatch || fieldSaving) return;
    setFieldSaving(true);
    try { await addDisbursementField(selectedBatch.id, input); setFieldOpen(false); setRetry(value => value + 1); }
    catch (error) { message.error((error as Error).message); }
    finally { setFieldSaving(false); }
  };

  return <section className="payroll-batches-workspace" aria-label="工资发放">
    <div className="salary-model-entries payroll-disbursement-toolbar">
      <DatePicker picker="month" aria-label="工资发放月份" placeholder="选择月份" variant="borderless" value={month} disabled={editingBusy || fieldSaving} onChange={value => { setMonth(value); setSelectedBatch(undefined); setDetail(undefined); setDetailError(''); setBatchOpen(false); }} />
      <button type="button" className="salary-model-entry" disabled={!selectedMonth || editingBusy || fieldSaving} onClick={() => setBatchOpen(true)}>选择批次</button>
      <button type="button" className="salary-model-entry" disabled={!selectedBatch || !detail || detailLoading || !!detailError || editingBusy || fieldSaving} onClick={() => { form.setFieldsValue({ name: '', category: 'info', required: true, displaySetting: 'none' }); setFieldOpen(true); }}>添加补充项</button>
    </div>
    {selectedBatch && (detailError ? <Alert type="error" message={detailError} action={<Button size="small" onClick={() => setRetry(value => value + 1)}>重试</Button>} /> : detail && detail.batchId === selectedBatch.id && !detailLoading ? <PayrollDisbursementBatch batch={selectedBatch} items={detail.items} model={detail.model} disbursement={detail.disbursement} onChange={disbursement => setDetail(current => current && current.batchId === selectedBatch.id ? { ...current, disbursement } : current)} onEditingChange={setEditingBusy} /> : <Spin />)}
    <Modal className="onboarding-template-editor salary-model-editor" title="添加补充项" open={fieldOpen} onCancel={() => { if (!fieldSaving) setFieldOpen(false); }} onOk={() => form.submit()} okText="保存" cancelText="取消" confirmLoading={fieldSaving} width={700}>
      <Form form={form} layout="vertical" onFinish={createField}>
        <div className="salary-single-field-form">
          <Form.Item className="salary-single-field-name" name="name" label="字段名称" rules={[{ required: true, whitespace: true, message: '请输入字段名称' }, { max: 60, message: '最多 60 个字符' }]}><Input maxLength={60} /></Form.Item>
          <Form.Item className="salary-single-field-required" name="required" valuePropName="checked"><Checkbox>必填</Checkbox></Form.Item>
          <Form.Item label="字段类型"><Select disabled value="number" options={[{ value: 'number', label: '数字' }]} /></Form.Item>
          <Form.Item name="category" label="字段用途" rules={[{ required: true }]}><Select options={[{ value: 'income', label: '收入' }, { value: 'deduction', label: '扣款' }, { value: 'info', label: '仅记录' }]} /></Form.Item>
          <Form.Item name="displaySetting" label="显示设置"><Select options={[{ value: 'none', label: '无' }, { value: 'display', label: '仅显示' }, { value: 'output', label: '仅输出' }]} /></Form.Item>
        </div>
      </Form>
    </Modal>
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
