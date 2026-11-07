import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, DatePicker, Form, Input, Modal, Popconfirm, Select, Space, Table, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { fetchDepartments, fetchJobTitles, type JobTitle } from '../../organization/api';
import { fetchEmployee } from '../../employees/api';
import { cancelHrTransition, getHrTransitions, submitHrTransition, type HrTransition } from '../api';
import type { AdminEmployee, DepartmentNode } from '../../../types';

type TransitionValues = { type: 'promotion' | 'transfer'; effectiveDate: Dayjs; position?: string; level?: string; jobCategory?: string; deptId?: string; note?: string };
const labels: Record<string, string> = { position: '职务', level: '职级', jobCategory: '职务', deptId: '部门' };
function departmentOptions(nodes: DepartmentNode[], prefix = ''): Array<{ value: string; label: string }> {
  return nodes.flatMap((node) => [{ value: node.id, label: `${prefix}${node.name}` }, ...departmentOptions(node.children || [], `${prefix}—`)]);
}

export function HrTransitions({ employeeId }: { employeeId: string }) {
  const { message } = App.useApp(); const [form] = Form.useForm<TransitionValues>();
  const [rows, setRows] = useState<HrTransition[]>([]); const [employee, setEmployee] = useState<AdminEmployee>();
  const [departments, setDepartments] = useState<Array<{ value: string; label: string }>>([]);
  const [jobTitles, setJobTitles] = useState<JobTitle[]>([]);
  const [loading, setLoading] = useState(false); const [failed, setFailed] = useState(false); const [open, setOpen] = useState(false);
  const load = async () => {
    setLoading(true);
    try { const [history, current, tree, titles] = await Promise.all([getHrTransitions(employeeId), fetchEmployee(employeeId), fetchDepartments(), fetchJobTitles()]); setRows(history); setEmployee(current); setDepartments(departmentOptions(tree)); setJobTitles(titles); setFailed(false); }
    catch (error) { setFailed(true); message.error((error as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [employeeId]);
  const submit = async (values: TransitionValues) => {
    const changes = Object.fromEntries(Object.entries({ position: values.position?.trim(), level: values.level?.trim(), jobCategory: values.jobCategory, deptId: values.deptId }).filter(([, value]) => value));
    if (!Object.keys(changes).length) { message.warning('请至少填写一项变更'); return; }
    setLoading(true);
    try { await submitHrTransition({ employeeId, type: values.type, effectiveDate: values.effectiveDate.format('YYYY-MM-DD'), changes, note: values.note || '' }); setOpen(false); form.resetFields(); await load(); message.success('人事异动已生效'); }
    catch (error) { message.error((error as Error).message); } finally { setLoading(false); }
  };
  const cancel = async (id: number) => {
    setLoading(true);
    try { await cancelHrTransition(id); await load(); message.success('异动已撤销'); }
    catch (error) { message.error((error as Error).message); } finally { setLoading(false); }
  };
  const describe = (snapshot: Record<string, string | null>) => Object.entries(snapshot).map(([key, value]) => `${labels[key] || key}：${key === 'deptId' ? departments.find((item) => item.value === value)?.label || value : value ?? '未设置'}`).join('；');
  return <Card title="调岗与晋升" bordered={false} extra={<Button type="primary" disabled={failed || loading} onClick={() => { form.resetFields(); setOpen(true); }}>新增异动</Button>}>
    {employee && <Typography.Paragraph>当前：{employee.deptName || '未设置部门'} · {employee.position} · {employee.level}</Typography.Paragraph>}
    {failed && <Alert type="error" message="异动资料加载失败" action={<Button onClick={() => void load()}>重试</Button>} />}
    <Table rowKey="id" loading={loading} dataSource={rows} pagination={{ pageSize: 5 }} scroll={{ x: 750 }} columns={[
      { title: '类型', render: (_: unknown, row: HrTransition) => row.type === 'promotion' ? '晋升' : '调岗' },
      { title: '生效日期', dataIndex: 'effectiveDate', render: (value: string) => dayjs(value).format('YYYY-MM-DD') },
      { title: '变更前', render: (_: unknown, row: HrTransition) => describe(row.before) },
      { title: '变更后', render: (_: unknown, row: HrTransition) => describe(row.after) },
      { title: '状态', render: (_: unknown, row: HrTransition) => row.status === 'submitted' ? '已生效' : '已撤销' },
      { title: '操作', render: (_: unknown, row: HrTransition) => row.status === 'submitted' ? <Popconfirm title="撤销此异动并恢复变更前的资料？" onConfirm={() => void cancel(row.id)} okText="撤销异动" cancelText="返回"><Button type="link" disabled={loading}>撤销</Button></Popconfirm> : '—' },
    ]} />
    <Modal title="新增人事异动" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={loading} okText="提交并生效" cancelText="取消" destroyOnClose>
      <Form form={form} layout="vertical" onFinish={submit} preserve={false} initialValues={{ effectiveDate: dayjs(), type: 'transfer' }}>
        <Form.Item name="type" label="异动类型" rules={[{ required: true }]}><Select options={[{ value: 'transfer', label: '调岗' }, { value: 'promotion', label: '晋升' }]} /></Form.Item>
        <Form.Item name="effectiveDate" label="生效日期" rules={[{ required: true }]}><DatePicker disabledDate={(date) => date.isAfter(dayjs(), 'day')} style={{ width: '100%' }} /></Form.Item>
        <Typography.Paragraph type="secondary">只填写需要变更的项目；未填写的项目保持原值。</Typography.Paragraph>
        <Form.Item name="deptId" label="新部门"><Select allowClear showSearch optionFilterProp="label" options={departments} /></Form.Item>
        <Form.Item name="position" label="新职务"><Select allowClear showSearch optionFilterProp="label" options={jobTitles.map(title => ({ value: title.name, label: title.name }))} /></Form.Item>
        <Form.Item name="level" label="新职级"><Input maxLength={20} /></Form.Item>
        <Form.Item name="note" label="说明"><Input.TextArea maxLength={500} /></Form.Item>
        <Space><Typography.Text type="secondary">新部门不会自动变更直属上级。</Typography.Text></Space>
      </Form>
    </Modal>
  </Card>;
}
