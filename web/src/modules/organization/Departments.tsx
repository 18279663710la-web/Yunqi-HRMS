import { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Avatar, Button, Form, Input, List, Modal, Popconfirm, Select, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined } from '@ant-design/icons';
import { useWorkspaceActive } from '../../layout/WorkspaceContext';
import { accountStatusTag, initialOf } from '../../utils/helpers';
import { createJobTitle, deleteJobTitle, fetchJobTitles, createOrganization, deleteOrganization, fetchOrganizations, renameOrganization, type JobTitle, type JobTitleEmployee, type Organization } from './api';
import './organization.css';

export function DepartmentsPage() {
  const { message } = App.useApp();
  const active = useWorkspaceActive();
  const [titles, setTitles] = useState<JobTitle[]>([]);
  const [filter, setFilter] = useState<number | undefined>();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationFilter, setOrganizationFilter] = useState<string>();
  const [organizationOpen, setOrganizationOpen] = useState(false);
  const [editingOrganization, setEditingOrganization] = useState<Organization>();
  const [organizationSaving, setOrganizationSaving] = useState(false);
  const [organizationDeleting, setOrganizationDeleting] = useState<string>();
  const [organizationForm] = Form.useForm<{ name: string }>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number>();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ name: string }>();
  const load = useCallback(async () => {
    setLoading(true);
    try { const [nextTitles, nextOrganizations] = await Promise.all([fetchJobTitles(), fetchOrganizations()]); setTitles(nextTitles); setOrganizations(nextOrganizations); } catch (error) { message.error((error as Error).message); }
    finally { setLoading(false); }
  }, [message]);
  useEffect(() => { if (active) void load(); }, [active, load]);
  const rows = useMemo(() => titles.filter(title => !filter || title.id === filter).flatMap(title => title.employees).filter(employee => !organizationFilter || employee.deptId === organizationFilter), [titles, filter, organizationFilter]);
  const columns: ColumnsType<JobTitleEmployee> = [
    { title: '员工', dataIndex: 'name', render: (_, row) => <Space><Avatar style={{ background: '#EAF0FF', color: '#3D6EF7' }}>{initialOf(row.name)}</Avatar><div><div className="table-primary">{row.name}{row.isLeader ? <span className="leader-dot">负责人</span> : null}</div><Typography.Text type="secondary">{row.employeeNo}</Typography.Text></div></Space> },
    { title: '职务', dataIndex: 'position' },
    { title: '组织', dataIndex: 'deptName', render: value => value || '未分配' },
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
  const saveOrganization = async ({ name }: { name: string }) => {
    setOrganizationSaving(true);
    try {
      if (editingOrganization) await renameOrganization(editingOrganization.id, name.trim());
      else await createOrganization(name.trim());
      message.success(editingOrganization ? '组织已修改' : '组织已创建');
      setEditingOrganization(undefined); organizationForm.resetFields(); await load();
    } catch (error) { message.error((error as Error).message); }
    finally { setOrganizationSaving(false); }
  };
  const removeOrganization = async (organization: Organization) => {
    setOrganizationDeleting(organization.id);
    try {
      await deleteOrganization(organization.id);
      if (organizationFilter === organization.id) setOrganizationFilter(undefined);
      if (editingOrganization?.id === organization.id) { setEditingOrganization(undefined); organizationForm.resetFields(); }
      await load(); message.success('组织已删除');
    } catch (error) { message.error((error as Error).message); }
    finally { setOrganizationDeleting(undefined); }
  };
  return <section className="organization-page" aria-label="组织架构">
    <div className="organization-toolbar">
      <Select aria-label="筛选职务" allowClear placeholder="全部职务" variant="borderless" value={filter} onChange={setFilter} options={titles.map(title => ({ value: title.id, label: title.name }))} className="organization-filter" />
      <Select aria-label="筛选组织" allowClear placeholder="全部组织" variant="borderless" value={organizationFilter} onChange={setOrganizationFilter} options={[{ value: 'D00', label: '未分配' }, ...organizations.map(item => ({ value: item.id, label: item.name }))]} className="organization-filter" />
      <button type="button" className="organization-toolbar-action" onClick={() => setOpen(true)}>编辑职务</button>
      <button type="button" className="organization-toolbar-action" onClick={() => setOrganizationOpen(true)}>编辑组织</button>
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
    <Modal title="编辑组织" open={organizationOpen} onCancel={() => { setOrganizationOpen(false); setEditingOrganization(undefined); organizationForm.resetFields(); }} footer={<Button onClick={() => { setOrganizationOpen(false); setEditingOrganization(undefined); organizationForm.resetFields(); }}>关闭</Button>} destroyOnHidden>
      <Form form={organizationForm} layout="vertical" onFinish={saveOrganization}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <Form.Item name="name" label="组织名称" style={{ flex: 1 }} rules={[{ required: true, whitespace: true, message: '请输入组织名称' }]}>
            <Input maxLength={50} placeholder="请输入组织名称" />
          </Form.Item>
          <Button type="primary" icon={editingOrganization ? undefined : <PlusOutlined />} htmlType="submit" loading={organizationSaving} disabled={organizationDeleting !== undefined} style={{ marginTop: 30 }}>{editingOrganization ? '保存' : '创建'}</Button>
          {editingOrganization && <Button style={{ marginTop: 30 }} onClick={() => { setEditingOrganization(undefined); organizationForm.resetFields(); }}>取消</Button>}
        </div>
      </Form>
      <List loading={loading} dataSource={organizations} locale={{ emptyText: '暂无组织' }} style={{ maxHeight: 'min(45vh, 400px)', overflowY: 'auto' }}
        renderItem={organization => <List.Item actions={[
          <Button key="edit" type="link" disabled={organizationSaving || organizationDeleting !== undefined} onClick={() => { setEditingOrganization(organization); organizationForm.setFieldsValue({ name: organization.name }); }}>编辑</Button>,
          <Popconfirm key="delete" title={`删除组织“${organization.name}”？`} onConfirm={() => removeOrganization(organization)} okText="删除" cancelText="取消" okButtonProps={{ loading: organizationDeleting === organization.id }}><Button type="link" danger aria-label={`删除${organization.name}`} disabled={organizationSaving || organizationDeleting !== undefined}>删除</Button></Popconfirm>,
        ]}><span>{organization.name}（{organization.count}）</span></List.Item>} />
    </Modal>
  </section>;
}
