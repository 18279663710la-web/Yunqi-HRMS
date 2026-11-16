import { useEffect, useState } from 'react';
import { Alert, App, Button, Checkbox, DatePicker, Dropdown, Form, Input, Modal, Popconfirm, Select, Spin, Table } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { SubModuleHeader } from '../../../components/SubModuleHeader';
import { useWorkspaceActive } from '../../../layout/WorkspaceContext';
import { addDisbursementField, getDisbursement, getDisbursementRecords, getPayrollBatches, type DisbursementFieldInput, type DisbursementState, type PayrollBatch, type PayrollBatchItem, type PayrollDisbursementRecord, type SalaryComponentModel } from '../api';
import { prepareAndIssuePayroll } from './payrollIssuePayslips';
import { PayrollDisbursementBatch } from './PayrollDisbursementBatch';
import { clearDisbursementPosition, disbursementStorage, readDisbursementPosition, rememberDisbursementBatch } from './disbursementPosition';
import { buildDisbursementExportData } from './payrollDisbursementExport';
import { useNavigate } from 'react-router-dom';

export function HrPayrollDisbursement() {
  const { message } = App.useApp();
  const workspaceActive = useWorkspaceActive();
  const [initialPosition] = useState(() => readDisbursementPosition(disbursementStorage()));
  const [pendingRestore, setPendingRestore] = useState(initialPosition);
  const [month, setMonth] = useState<Dayjs | null>(() => initialPosition ? dayjs(`${initialPosition.month}-01`) : null);
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
  const [issuing, setIssuing] = useState(false);
  const [issueProgress, setIssueProgress] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [editingBusy, setEditingBusy] = useState(false);
  const [form] = Form.useForm<DisbursementFieldInput>();
  const selectedMonth = month?.format('YYYY-MM');

  useEffect(() => {
    if (!workspaceActive || !pendingRestore) return;
    let active = true;
    getPayrollBatches(pendingRestore.month).then(rows => {
      if (!active) return;
      const batch = rows.find(item => item.id === pendingRestore.batchId && item.month === pendingRestore.month && item.status === 'reviewed');
      if (batch) setSelectedBatch(batch);
      else clearDisbursementPosition(disbursementStorage());
      setPendingRestore(undefined);
    }).catch((error: Error) => {
      if (active) { message.error(error.message); setPendingRestore(undefined); }
    });
    return () => { active = false; };
  }, [workspaceActive, pendingRestore]);

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
    getDisbursement(selectedBatch.id).then(disbursement => {
      if (!disbursement.snapshot) throw new Error('工资发放数据不完整');
      if (active) setDetail({ batchId: selectedBatch.id, items: disbursement.snapshot.items, model: disbursement.snapshot.model, disbursement });
    }).catch((error: Error) => { if (active) { setDetail(undefined); setDetailError(error.message || '工资明细加载失败'); } }).finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [workspaceActive, selectedBatch, retry, editingBusy, fieldSaving]);

  const createField = async (input: DisbursementFieldInput) => {
    if (!selectedBatch || fieldSaving || detail?.disbursement.issued) return;
    setFieldSaving(true);
    try { await addDisbursementField(selectedBatch.id, input); setFieldOpen(false); setRetry(value => value + 1); }
    catch (error) { message.error((error as Error).message); }
    finally { setFieldSaving(false); }
  };
  const busy = editingBusy || fieldSaving || issuing || exporting;
  const issue = async () => {
    if (!selectedBatch || !detail?.disbursement.revision || busy || detail.disbursement.issued) return;
    setIssuing(true); setIssueProgress(0);
    try {
      const result = await prepareAndIssuePayroll(selectedBatch, detail.items, detail.model, detail.disbursement, undefined, completed => setIssueProgress(completed));
      setDetail(current => current && current.batchId === selectedBatch.id ? { ...current, disbursement: { ...current.disbursement, issued: true, recordId: result.id, sentItemIds: detail.items.map(item => item.id) } } : current);
      message.success('工资批次已发放，工资条已发送'); setRetry(value => value + 1);
    } catch (error) { message.error((error as Error).message); setRetry(value => value + 1); }
    finally { setIssuing(false); setIssueProgress(0); }
  };
  const exportBatch = async (format: 'pdf' | 'xlsx') => {
    if (!selectedBatch || !detail || busy || detailLoading || detailError) return;
    setExporting(true);
    try {
      const data = buildDisbursementExportData(selectedBatch, detail.items, detail.model, detail.disbursement);
      if (format === 'pdf') await (await import('./payrollExportPdf')).downloadPayrollPdf(data);
      else await (await import('./payrollExportXlsx')).downloadPayrollXlsx(data);
    } catch (error) { message.error((error as Error).message || '输出失败，请重试'); }
    finally { setExporting(false); }
  };

  return <section className="payroll-batches-workspace" aria-label="工资发放">
    <SubModuleHeader title="工资发放" />
    <div className="salary-model-entries payroll-disbursement-toolbar">
      <DatePicker picker="month" aria-label="工资发放月份" placeholder="选择月份" variant="borderless" value={month} disabled={busy} onChange={value => { setPendingRestore(undefined); clearDisbursementPosition(disbursementStorage()); setMonth(value); setSelectedBatch(undefined); setDetail(undefined); setDetailError(''); setBatchOpen(false); }} />
      <button type="button" className="salary-model-entry" disabled={!selectedMonth || busy} onClick={() => setBatchOpen(true)}>选择批次</button>
      <button type="button" className="salary-model-entry" disabled={!selectedBatch || !detail || detailLoading || !!detailError || busy || !!detail.disbursement.issued} onClick={() => { form.setFieldsValue({ name: '', category: 'info', required: true, displaySetting: 'none' }); setFieldOpen(true); }}>添加补充项</button>
      <Popconfirm title="确认发放该工资批次并发送工资条？发放后不能修改。" onConfirm={() => void issue()} okText="确认" cancelText="取消" disabled={!detail || detailLoading || !!detailError || busy || !!detail.disbursement.issued || !detail.items.length}>
        <button type="button" className="salary-model-entry payroll-issue-action" disabled={!detail || detailLoading || !!detailError || busy || !!detail.disbursement.issued || !detail.items.length}>{issuing ? `发放 ${issueProgress}/${detail?.items.length ?? 0}` : '发放'}</button>
      </Popconfirm>
      <Dropdown trigger={['click']} disabled={!detail || detailLoading || !!detailError || busy || !detail.items.length} menu={{ items: [{ key: 'pdf', label: 'PDF' }, { key: 'xlsx', label: 'XLSX' }], onClick: ({ key }) => void exportBatch(key as 'pdf' | 'xlsx') }}>
        <button type="button" className="salary-model-entry" disabled={!detail || detailLoading || !!detailError || busy || !detail.items.length}>输出</button>
      </Dropdown>
    </div>
    {selectedBatch && (detailError ? <Alert type="error" message={detailError} action={<Button size="small" onClick={() => setRetry(value => value + 1)}>重试</Button>} /> : detail && detail.batchId === selectedBatch.id ? <PayrollDisbursementBatch batch={selectedBatch} items={detail.items} model={detail.model} disbursement={detail.disbursement} refreshing={detailLoading || issuing || exporting || fieldSaving} onChange={disbursement => setDetail(current => current && current.batchId === selectedBatch.id ? { ...current, items: disbursement.snapshot?.items ?? current.items, model: disbursement.snapshot?.model ?? current.model, disbursement } : current)} onEditingChange={setEditingBusy} /> : <Spin />)}
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
        { title: '批次编号', dataIndex: 'id' },
        { title: '工资月份', dataIndex: 'month' },
        { title: '状态', render: () => '已复核' },
        { title: '操作', render: (_: unknown, batch: PayrollBatch) => <Button type="link" onClick={() => { setPendingRestore(undefined); rememberDisbursementBatch(disbursementStorage(), batch.month, batch.id); setDetail(undefined); setDetailError(''); setSelectedBatch(batch); setBatchOpen(false); }}>选择</Button> },
      ]} />
    </Modal>
  </section>;
}

export function HrPayrollRecords() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const workspaceActive = useWorkspaceActive();
  const [rows, setRows] = useState<PayrollDisbursementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!workspaceActive) return;
    let active = true;
    setLoading(true);
    getDisbursementRecords().then(records => { if (active) setRows(records); }).catch((error: Error) => { if (active) message.error(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceActive]);
  return <>
    <SubModuleHeader title="工资发放记录" />
    <Table rowKey="id" loading={loading} dataSource={rows} pagination={{ pageSize: 10 }} scroll={{ x: 700 }} columns={[
      { title: '类型', render: () => '工资批次' },
      { title: '批次编号', dataIndex: 'batchId' },
      { title: '工资月份', render: (_: unknown, row: PayrollDisbursementRecord) => <Button type="link" onClick={() => navigate(`/hr/payroll-records/${row.id}/${row.month}`)}>{row.month}</Button> },
      { title: '应发工资', dataIndex: 'grossTotal', render: (n: number) => `¥${Number(n).toFixed(2)}` },
      { title: '实发工资', dataIndex: 'netTotal', render: (n: number) => `¥${Number(n).toFixed(2)}` },
      { title: '备注', dataIndex: 'note', render: (v: string) => v || '—' }, { title: '登记时间', dataIndex: 'createdAt', render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
    ]} />
  </>;
}
