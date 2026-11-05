import { useEffect, useState } from 'react';
import { App, Button, DatePicker, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Typography } from 'antd';
import { type Dayjs } from 'dayjs';
import { addAutoPayrollItems, addPayrollBatchItem, createPayrollBatch, deletePayrollBatch, getPayrollBatches, getPayrollBatchItems, getSalaryComponentModel, previewAutoPayrollItems, removePayrollBatchItem, reviewPayrollBatch, updatePayrollExtended, type AutoPayrollPreview, type HrEmployee, type PayrollBatch, type PayrollBatchItem, type SalaryComponentModel } from '../api';
import { SubModuleHeader } from '../../../components/SubModuleHeader';
import { salaryAmountFields } from '../../models-formulas/salary/salaryModel';
import { useWorkspaceActive } from '../../../layout/WorkspaceContext';

const money = (value: number | null | undefined) => value == null ? '—' : `¥${Number(value).toFixed(2)}`;
const categoryNames = { income: '收入', deduction: '扣款', info: '仅记录' };

export function HrPayrollBatches({ employees }: { employees: HrEmployee[] }) {
  const { message } = App.useApp();
  const workspaceActive = useWorkspaceActive();
  const [batches, setBatches] = useState<PayrollBatch[]>([]);
  const [selected, setSelected] = useState<number>();
  const [items, setItems] = useState<PayrollBatchItem[]>([]);
  const [model, setModel] = useState<SalaryComponentModel>();
  const [loading, setLoading] = useState(false);
  const [month, setMonth] = useState<Dayjs | null>(null);
  const [open, setOpen] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const [autoPreview, setAutoPreview] = useState<AutoPayrollPreview>();
  const [autoLoading, setAutoLoading] = useState(false);
  const [editing, setEditing] = useState<PayrollBatchItem>();
  const [legacyItem, setLegacyItem] = useState<PayrollBatchItem>();
  const [form] = Form.useForm<{ employeeId: string }>();
  const [extendedForm] = Form.useForm<{ values: (number | string)[] }>();
  const current = batches.find(item => item.id === selected);
  const loadBatches = async () => { setBatches(await getPayrollBatches()); };
  const loadItems = async (id: number) => { setItems(await getPayrollBatchItems(id)); };
  useEffect(() => {
    if (!workspaceActive) return;
    let active = true;
    getPayrollBatches().then(rows => { if (active) setBatches(rows); }).catch((error: Error) => { if (active) message.error(error.message); });
    getSalaryComponentModel().then(result => { if (active) setModel(result); }).catch((error: Error) => { if (active) message.error(error.message); });
    return () => { active = false; };
  }, [workspaceActive]);
  useEffect(() => {
    if (!workspaceActive) return;
    let active = true; setItems([]);
    if (selected) getPayrollBatchItems(selected).then(rows => { if (active) setItems(rows); }).catch((error: Error) => { if (active) message.error(error.message); });
    return () => { active = false; };
  }, [selected, workspaceActive]);
  const create = async () => {
    if (!month) { message.warning('请选择工资月份'); return; }
    setLoading(true);
    try { const result = await createPayrollBatch(month.format('YYYY-MM')); await loadBatches(); setSelected(result.id); message.success('工资批次已创建'); }
    catch (error) { message.error((error as Error).message); } finally { setLoading(false); }
  };
  const add = async (values: { employeeId: string }) => {
    if (!selected) return; setLoading(true);
    try { await addPayrollBatchItem(selected, values); setOpen(false); form.resetFields(); await loadItems(selected); message.success('工资明细已添加'); }
    catch (error) { message.error((error as Error).message); } finally { setLoading(false); }
  };
  const openAutoPreview = async () => {
    if (!selected || current?.status !== 'draft') return;
    setAutoLoading(true);
    try {
      const preview = await previewAutoPayrollItems(selected);
      if (!preview.candidates.length) { message.info(preview.existingCount ? `没有可添加的员工，${preview.existingCount} 人已在本批次` : '没有同时满足封存入职表、劳动合同和定薪条件的员工'); return; }
      setOpen(false); setAutoPreview(preview); setAutoOpen(true);
    } catch (error) { message.error((error as Error).message); } finally { setAutoLoading(false); }
  };
  const confirmAuto = async () => {
    if (!selected) return; setLoading(true);
    try { const result = await addAutoPayrollItems(selected); setAutoOpen(false); setAutoPreview(undefined); await loadItems(selected); message.success(`已添加 ${result.addedCount} 人${result.skippedExisting ? `；跳过 ${result.skippedExisting} 人` : ''}`); }
    catch (error) { message.error((error as Error).message); } finally { setLoading(false); }
  };
  const saveExtended = async (input: { values: (number | string)[] }) => {
    if (!selected || !editing?.modelSnapshot) return; setLoading(true);
    try {
      await updatePayrollExtended(selected, editing.id, { revision: editing.modelSnapshot.revision ?? 0, values: editing.modelSnapshot.extended.map((field, index) => ({ name: field.name, value: input.values[index] })) });
      setEditing(undefined); await loadItems(selected); message.success('工资明细已保存');
    } catch (error) { message.error((error as Error).message); } finally { setLoading(false); }
  };
  const remove = async (itemId: number) => {
    if (!selected) return; setLoading(true);
    try { await removePayrollBatchItem(selected, itemId); await loadItems(selected); message.success('草稿明细已删除'); }
    catch (error) { message.error((error as Error).message); } finally { setLoading(false); }
  };
  const removeDraft = async () => {
    if (!selected) return; setLoading(true);
    try { await deletePayrollBatch(selected); setSelected(undefined); setItems([]); await loadBatches(); message.success('草稿批次已删除'); }
    catch (error) { message.error((error as Error).message); } finally { setLoading(false); }
  };
  const review = async () => {
    if (!selected) return; setLoading(true);
    try { await reviewPayrollBatch(selected); await Promise.all([loadBatches(), loadItems(selected)]); message.success('工资批次已复核'); }
    catch (error) { message.error((error as Error).message); } finally { setLoading(false); }
  };
  const modelFields = [...salaryAmountFields(model), ...(model?.extendedFields ?? [])].map(field => field.name);
  const snapshotFields = items.flatMap(item => [...(item.modelSnapshot?.fixed ?? []), ...(item.modelSnapshot?.extended ?? [])].map(field => field.name));
  const fieldNames = [...new Set([...modelFields, ...snapshotFields])];
  const columns = [
    { title: '姓名', dataIndex: 'name', width: 100, fixed: 'left' as const },
    { title: '员工号', dataIndex: 'employeeNo', width: 110 },
    { title: '职务', width: 120, render: (_: unknown, row: PayrollBatchItem) => row.modelSnapshot?.position ?? row.position ?? '—' },
    ...fieldNames.map(name => ({ title: name, key: name, width: 120, render: (_: unknown, row: PayrollBatchItem) => {
      const field = [...(row.modelSnapshot?.fixed ?? []), ...(row.modelSnapshot?.extended ?? [])].find(item => item.name === name);
      return field ? typeof field.value === 'number' ? field.value.toFixed(2) : field.value || '—' : '—';
    } })),
    { title: '应发', dataIndex: 'gross', width: 120, render: (value: number) => money(value) },
    { title: '扣除', dataIndex: 'deductions', width: 120, render: (value: number) => money(value) },
    { title: '实发', dataIndex: 'net', width: 120, render: (value: number) => money(value) },
    { title: '操作', key: 'actions', width: 180, fixed: 'right' as const, render: (_: unknown, row: PayrollBatchItem) => <Space>
      {!row.modelSnapshot && <Button type="link" onClick={() => setLegacyItem(row)}>查看原明细</Button>}
      {current?.status === 'draft' && row.modelSnapshot && <Button type="link" onClick={() => { extendedForm.setFieldsValue({ values: row.modelSnapshot!.extended.map(field => field.value) }); setEditing(row); }}>填写扩展</Button>}
      {current?.status === 'draft' && <Popconfirm title="删除此草稿明细？" onConfirm={() => void remove(row.id)} okText="删除" cancelText="取消"><Button type="link" danger>删除</Button></Popconfirm>}
    </Space> },
  ];
  return <>
    <SubModuleHeader title="工资批次" />
    <Space wrap><DatePicker picker="month" aria-label="新建工资月份" value={month} onChange={setMonth} /><Button onClick={() => void create()} loading={loading}>创建批次</Button><Select aria-label="选择工资批次" value={selected} placeholder="选择批次" style={{ minWidth: 220 }} onChange={setSelected} options={batches.map(batch => ({ value: batch.id, label: `${batch.month} · ${batch.status === 'draft' ? '草稿' : '已复核'}` }))} /></Space>
    {current && <>
      <div style={{ margin: '16px 0' }}><Space wrap><Typography.Text strong>{current.month} · {current.status === 'draft' ? '草稿' : '已复核'}</Typography.Text>
        {current.status === 'draft' && <><Button type="primary" onClick={() => { form.resetFields(); setOpen(true); }}>添加工资明细</Button><Popconfirm title="确认复核该批次？复核后不能修改。" onConfirm={() => void review()} okText="确认" cancelText="取消"><Button disabled={loading || !items.length}>复核并锁定</Button></Popconfirm><Popconfirm title="删除该草稿及其全部工资明细？" onConfirm={() => void removeDraft()} okText="删除" cancelText="取消"><Button danger disabled={loading}>删除草稿</Button></Popconfirm></>}
      </Space></div>
      <Table rowKey="id" loading={loading} dataSource={items} pagination={{ pageSize: 10 }} scroll={{ x: 'max-content' }} columns={columns} />
      {items.length > 0 && <div style={{ marginTop: 12 }}><Space wrap><Typography.Text strong>本批次合计：</Typography.Text><Typography.Text>应发 {money(items.reduce((sum, item) => sum + Number(item.gross), 0))}</Typography.Text><Typography.Text>扣除 {money(items.reduce((sum, item) => sum + Number(item.deductions), 0))}</Typography.Text><Typography.Text strong>实发 {money(items.reduce((sum, item) => sum + Number(item.net), 0))}</Typography.Text></Space></div>}
    </>}
    <Modal title="添加工资明细" open={open} onCancel={() => setOpen(false)} width={520} destroyOnHidden footer={<div style={{ display: 'flex', justifyContent: 'space-between' }}><Button onClick={() => void openAutoPreview()} loading={autoLoading}>一键添加</Button><Space><Button onClick={() => setOpen(false)}>取消</Button><Button type="primary" loading={loading} onClick={() => form.submit()}>确定</Button></Space></div>}>
      <Form form={form} layout="vertical" onFinish={add} preserve={false}><Form.Item label="员工" name="employeeId" rules={[{ required: true, message: '请选择员工' }]}><Select showSearch optionFilterProp="label" options={employees.map(employee => ({ value: employee.id, label: `${employee.name} · ${employee.employeeNo}${employee.employmentStatus === 'departed' ? ' · 已离职' : ''}` }))} /></Form.Item></Form>
    </Modal>
    <Modal title={autoPreview ? `一键添加工资明细 · ${autoPreview.month}` : '一键添加工资明细'} open={autoOpen} onCancel={() => setAutoOpen(false)} width={900} footer={<Space><Button onClick={() => setAutoOpen(false)}>取消</Button><Button type="primary" loading={loading} onClick={() => void confirmAuto()}>确认添加 {autoPreview?.candidates.length ?? 0} 人</Button></Space>}>
      {autoPreview && <><Table rowKey="employeeId" dataSource={autoPreview.candidates} pagination={false} size="small" scroll={{ x: 'max-content', y: 360 }} columns={[
        { title: '姓名', dataIndex: 'name', width: 100 }, { title: '员工号', dataIndex: 'employeeNo', width: 100 }, { title: '职务', dataIndex: 'position', width: 120 },
        ...([...(autoPreview.candidates[0]?.modelSnapshot.fixed ?? []), ...(autoPreview.candidates[0]?.modelSnapshot.extended ?? [])]).map(field => ({ title: field.name, key: field.name, width: 120, render: (_: unknown, row: typeof autoPreview.candidates[number]) => { const value = [...row.modelSnapshot.fixed, ...row.modelSnapshot.extended].find(item => item.name === field.name)?.value; return typeof value === 'number' ? value.toFixed(2) : value || '—'; } })),
        { title: '固定薪资合计', dataIndex: 'baseGross', width: 130, render: (value: number) => money(value) },
      ]} /><Typography.Text strong>合计：{money(autoPreview.totals.baseGross)}</Typography.Text></>}
    </Modal>
    <Modal title={`填写扩展薪资 · ${editing?.name ?? ''}`} open={!!editing} onCancel={() => setEditing(undefined)} onOk={() => extendedForm.submit()} confirmLoading={loading} width={650} styles={{ body: { maxHeight: '65vh', overflowY: 'auto' } }}>
      <Form form={extendedForm} layout="vertical" onFinish={saveExtended} preserve={false}>{editing?.modelSnapshot?.extended.map((field, index) => <Form.Item key={field.name} label={`${field.name}（${categoryNames[field.category]}）`} name={['values', index]} rules={field.type === 'text' ? undefined : [{ required: true, message: '请输入数值' }]}>{field.type === 'text' ? <Input maxLength={200} /> : <InputNumber disabled={!!field.attendanceMetric} min={0} max={9999999999.99} precision={2} style={{ width: '100%' }} />}</Form.Item>)}</Form>
    </Modal>
    <Modal title={`原工资明细 · ${legacyItem?.name ?? ''}`} open={!!legacyItem} onCancel={() => setLegacyItem(undefined)} footer={<Button onClick={() => setLegacyItem(undefined)}>关闭</Button>}>
      {legacyItem && <Descriptions column={1} size="small" items={[
        { key: 'base', label: '应发（调整前）', children: money(legacyItem.baseGross) },
        { key: 'rate', label: '出勤率', children: legacyItem.attendanceRate == null ? '—' : `${Number(legacyItem.attendanceRate).toFixed(2)}%` },
        { key: 'adjustment', label: '绩效调整', children: money(legacyItem.attendanceAdjustment) },
        { key: 'time', label: '加班时长', children: `${Number(legacyItem.overtimeSeconds)} 秒` },
        { key: 'overtime', label: '加班绩效', children: money(legacyItem.overtimePay) },
        { key: 'gross', label: '应发', children: money(legacyItem.gross) },
        { key: 'deductions', label: '扣除', children: money(legacyItem.deductions) },
        { key: 'net', label: '实发', children: money(legacyItem.net) },
        { key: 'note', label: '说明', children: legacyItem.note || '—' },
      ]} />}
    </Modal>
  </>;
}
