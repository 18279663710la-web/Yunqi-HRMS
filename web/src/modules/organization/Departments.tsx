import { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Avatar, Button, Form, Input, List, Modal, Popconfirm, Select, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined } from '@ant-design/icons';
import { useWorkspaceActive } from '../../layout/WorkspaceContext';
import { accountStatusTag, initialOf } from '../../utils/helpers';
import { createJobTitle, deleteJobTitle, fetchJobTitles, type JobTitle, type JobTitleEmployee } from './api';
import './organization.css';

export function DepartmentsPage() {
  const { message } = App.useApp();
  const active = useWorkspaceActive();
  const [titles, setTitles] = useState<JobTitle[]>([]);
  const [filter, setFilter] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number>();
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
    try { await createJobTitle(name.trim()); form.resetFields(); await load(); message.success('职务已创建'); }
    catch (error) { message.error((error as Error).message); }
    finally { setSaving(false); }
  };
  const remove = async (title: JobTitle) => {
    setDeletingId(title.id);
    try { await deleteJobTitle(title.id); if (filter === title.id) setFilter(undefined); await load(); message.success('职务已删除'); }
    catch (error) { message.error((error as Error).message); }
    finally { setDeletingId(undefined); }
  };
  return <section className="organization-page" aria-label="组织架构">
    <div className="organization-toolbar">
      <Select aria-label="筛选职务" allowClear placeholder="全部职务" variant="borderless" value={filter} onChange={setFilter} options={titles.map(title => ({ value: title.id, label: title.name }))} className="organization-filter" />
      <button type="button" className="organization-toolbar-action" onClick={() => setOpen(true)}>编辑</button>
    </div>
    <div className="organization-table">
      <Table rowKey="id" loading={loading} columns={columns} dataSource={rows} pagination={{ pageSize: 15, showSizeChanger: true, showTotal: total => `共 ${total} 人` }} scroll={{ x: 850 }} />
    </div>
    <Modal title="编辑职务" open={open} onCancel={() => { setOpen(false); form.resetFields(); }} footer={<Button onClick={() => { setOpen(false); form.resetFields(); }}>关闭</Button>} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={add}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <Form.Item name="name" label="职务名称" style={{ flex: 1 }} rules={[{ required: true, whitespace: true, message: '请输入职务名称' }]}>
            <Input maxLength={100} placeholder="请输入职务名称" />
          </Form.Item>
          <Button type="primary" icon={<PlusOutlined />} htmlType="submit" loading={saving} disabled={deletingId !== undefined} style={{ marginTop: 30 }}>创建</Button>
        </div>
      </Form>
      <List
        loading={loading}
        dataSource={titles}
        locale={{ emptyText: '暂无职务' }}
        style={{ maxHeight: 'min(45vh, 400px)', overflowY: 'auto' }}
        renderItem={title => <List.Item actions={[<Popconfirm key="delete" title={`删除职务“${title.name}”？`} onConfirm={() => remove(title)} okText="删除" cancelText="取消" okButtonProps={{ loading: deletingId === title.id }}><Button type="link" danger aria-label={`删除${title.name}`} disabled={saving || deletingId !== undefined}>删除</Button></Popconfirm>]}><span>{title.name}（{title.count}）</span></List.Item>}
      />
    </Modal>
  </section>;
}
