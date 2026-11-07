import { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Avatar, Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined } from '@ant-design/icons';
import { PageTitle } from '../../components/PageTitle';
import { useWorkspaceActive } from '../../layout/WorkspaceContext';
import { accountStatusTag, initialOf } from '../../utils/helpers';
import { createJobTitle, deleteJobTitle, fetchJobTitles, type JobTitle, type JobTitleEmployee } from './api';

export function DepartmentsPage() {
  const { message } = App.useApp();
  const active = useWorkspaceActive();
  const [titles, setTitles] = useState<JobTitle[]>([]);
  const [filter, setFilter] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ name: string }>();
  const load = useCallback(async () => {
    setLoading(true);
    try { setTitles(await fetchJobTitles()); } catch (error) { message.error((error as Error).message); }
    finally { setLoading(false); }
  }, [message]);
  useEffect(() => { if (active) void load(); }, [active, load]);
  const rows = useMemo(() => titles.filter(title => !filter || title.id === filter).flatMap(title => title.employees), [titles, filter]);
  const columns: ColumnsType<JobTitleEmployee> = [
    { title: '员工', dataIndex: 'name', render: (_, row) => <Space><Avatar style={{ background: '#EAF0FF', color: '#3D6EF7' }}>{initialOf(row.name)}</Avatar><div><div className="table-primary">{row.name}{row.isLeader ? <span className="leader-dot">负责人</span> : null}</div><Typography.Text type="secondary">{row.employeeNo}</Typography.Text></div></Space> },
    { title: '职务', dataIndex: 'position' },
    { title: '手机号', dataIndex: 'phone' },
    { title: '入职日期', dataIndex: 'joinDate' },
    { title: '登录账号', render: (_, row) => <Space>{accountStatusTag(row.accountStatus)}{row.loginName}</Space> },
  ];
  const add = async ({ name }: { name: string }) => {
    setSaving(true);
    try { await createJobTitle(name.trim()); setOpen(false); form.resetFields(); await load(); message.success('职务已创建'); }
    catch (error) { message.error((error as Error).message); }
    finally { setSaving(false); }
  };
  const remove = async (title: JobTitle) => {
    try { await deleteJobTitle(title.id); if (filter === title.id) setFilter(undefined); await load(); message.success('职务已删除'); }
    catch (error) { message.error((error as Error).message); }
  };
  return <div className="page-stack">
    <PageTitle title="组织架构" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>创建职务</Button>} />
    <Card className="panel-card" bordered={false} title="职务管理" loading={loading}>
      <Space wrap>{titles.map(title => <Space.Compact key={title.id}><Button type={filter === title.id ? 'primary' : 'default'} onClick={() => setFilter(filter === title.id ? undefined : title.id)}>{title.name}（{title.count}）</Button><Popconfirm title={`删除职务“${title.name}”？`} onConfirm={() => remove(title)} okText="删除" cancelText="取消"><Button danger aria-label={`删除${title.name}`}>删除</Button></Popconfirm></Space.Compact>)}</Space>
    </Card>
    <Card className="panel-card" bordered={false} extra={<Select aria-label="筛选职务" allowClear placeholder="全部职务" value={filter} onChange={setFilter} options={titles.map(title => ({ value: title.id, label: title.name }))} style={{ minWidth: 180 }} />}>
      <Table rowKey="id" loading={loading} columns={columns} dataSource={rows} pagination={{ pageSize: 15, showSizeChanger: true, showTotal: total => `共 ${total} 人` }} scroll={{ x: 850 }} />
    </Card>
    <Modal title="创建职务" open={open} confirmLoading={saving} onOk={() => form.submit()} onCancel={() => { setOpen(false); form.resetFields(); }} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={add}><Form.Item name="name" label="职务名称" rules={[{ required: true, whitespace: true, message: '请输入职务名称' }]}><Input maxLength={100} /></Form.Item></Form>
    </Modal>
  </div>;
}
