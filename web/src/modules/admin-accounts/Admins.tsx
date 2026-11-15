import { useEffect, useState } from 'react';
import {
  App as AntApp,
  Avatar,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Result,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { KeyOutlined, PlusOutlined, SafetyCertificateOutlined } from '@ant-design/icons';

import { createAdmin, fetchAdmins, resetAdminPassword, setAdminStatus } from './api';
import { useAuth } from '../../auth/AuthContext';
import { PageTitle } from '../../components/PageTitle';
import type { AdminAccountItem, AdminRole } from '../../types';
import { roleLabel } from '../../utils/helpers';

const { Text } = Typography;

interface AdminFormValues {
  username: string;
  name: string;
  password: string;
  role: AdminRole;
}

interface ResetFormValues {
  password: string;
}

export function AdminsPage() {
  const { admin: currentAdmin } = useAuth();
  const { message, modal } = AntApp.useApp();
  const [list, setList] = useState<AdminAccountItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<AdminAccountItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<AdminFormValues>();
  const [resetForm] = Form.useForm<ResetFormValues>();

  const load = async () => {
    if (currentAdmin?.role !== 'super_admin') return;
    setLoading(true);
    try {
      const admins = await fetchAdmins();
      setList(admins);
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [currentAdmin?.role]);

  useEffect(() => {
    if (createOpen) {
      form.resetFields();
      form.setFieldsValue({ role: 'hr_admin' });
    }
  }, [createOpen, form]);

  useEffect(() => {
    if (resetOpen) resetForm.resetFields();
  }, [resetOpen, resetForm]);

  if (currentAdmin?.role !== 'super_admin') {
    return (
      <Result
        status="403"
        title="无权限访问"
        subTitle="只有超级管理员可以创建和管理后台账号。"
      />
    );
  }

  const submitCreate = async (values: AdminFormValues) => {
    setSaving(true);
    try {
      await createAdmin({
        username: values.username.trim(),
        name: values.name.trim(),
        password: values.password,
        role: values.role,
      });
      message.success('管理员账号已创建');
      setCreateOpen(false);
      await load();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const submitReset = async (values: ResetFormValues) => {    if (!resetTarget) return;
    setSaving(true);
    try {
      await resetAdminPassword(resetTarget.id, values.password);
      message.success('密码已重置');
      setResetOpen(false);
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = (record: AdminAccountItem) => {
    const next = !record.status;
    modal.confirm({
      title: next ? '启用管理员账号' : '停用管理员账号',
      content: next
        ? `确定要启用 ${record.name}（${record.username}）吗？`
        : `停用后，${record.name} 将无法登录管理后台。`,
      okText: next ? '确认启用' : '确认停用',
      okButtonProps: { danger: !next },
      cancelText: '取消',
      onOk: async () => {
        try {
          await setAdminStatus(record.id, next);
          message.success(next ? '已启用' : '已停用');
          await load();
        } catch (err) {
          message.error((err as Error).message);
        }
      },
    });
  };

  const columns: ColumnsType<AdminAccountItem> = [
    {
      title: '管理员',
      dataIndex: 'name',
      width: 220,
      render: (_, row) => (
        <Space>
          <Avatar style={{ background: '#F0F0F0', color: '#1A1A1A' }}>
            {row.name.slice(0, 1)}
          </Avatar>
          <div>
            <div className="table-primary">
              {row.name}
              {row.id === currentAdmin.id ? <Tag color="#F5F5F5" bordered={false} style={{ marginLeft: 8 }}>当前账号</Tag> : null}
            </div>
            <Text type="secondary" className="table-secondary">{row.username}</Text>
          </div>
        </Space>
      ),
    },
    {
      title: '角色',
      dataIndex: 'role',
      width: 130,
      render: (role: AdminRole) => (
        <Tag color={role === 'super_admin' ? '#C9A75C' : 'default'}>{roleLabel(role)}</Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (status: boolean) => (status ? <Tag color="success">启用</Tag> : <Tag color="error">停用</Tag>),
    },
    { title: '最近登录', dataIndex: 'lastLoginAt', width: 160, render: (value: string | null) => value || '从未登录' },
    { title: '创建时间', dataIndex: 'createdAt', width: 160 },
    {
      title: '操作',
      key: 'actions',
      width: 180,
      render: (_, row) => (
        <Space size={12}>
          <Button
            type="link"
            size="small"
            icon={<KeyOutlined />}
            style={{ padding: 0 }}
            onClick={() => {
              setResetTarget(row);
              setResetOpen(true);
            }}
          >
            重置密码
          </Button>
          <Button
            type="link"
            size="small"
            danger={row.status}
            style={{ padding: 0 }}
            disabled={row.id === currentAdmin.id}
            onClick={() => toggleStatus(row)}
          >
            {row.status ? '停用' : '启用'}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-stack">
      <PageTitle
        title="管理员账号"
        subtitle="管理后台登录账号与角色；员工的小程序账号请到「员工与账号」中维护"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            新增管理员
          </Button>
        }
      />

      <Card className="panel-card" bordered={false}>
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={list}
          pagination={false}
          scroll={{ x: 880 }}
        />
      </Card>

      <Modal
        title="新增管理员"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saving}
        okText="创建"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" onFinish={submitCreate}>
          <Form.Item
            name="username"
            label="登录名"
            rules={[
              { required: true, message: '请输入登录名' },
              { pattern: /^[A-Za-z0-9_.-]{3,30}$/, message: '3-30 位字母、数字、下划线、点或短横线' },
            ]}
          >
            <Input placeholder="如：hr_admin" autoComplete="off" />
          </Form.Item>
          <Form.Item name="name" label="显示名称" rules={[{ required: true, message: '请输入显示名称' }]}>
            <Input placeholder="如：人力资源管理员" />
          </Form.Item>
          <Form.Item
            name="password"
            label="初始密码"
            rules={[
              { required: true, message: '请输入初始密码' },
              { min: 6, message: '密码至少 6 位' },
            ]}
          >
            <Input.Password placeholder="至少 6 位" autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'hr_admin', label: 'HR 管理员（员工/考勤管理）' },
                { value: 'super_admin', label: '超级管理员（全部权限）' },
              ]}
            />
          </Form.Item>
          <div className="form-tip">
            <SafetyCertificateOutlined /> HR 管理员可以管理员工、账号与考勤，但不能创建或停用其他管理员。
          </div>
        </Form>
      </Modal>

      <Modal
        title="重置管理员密码"
        open={resetOpen}
        onCancel={() => setResetOpen(false)}
        onOk={() => resetForm.submit()}
        confirmLoading={saving}
        okText="重置密码"
        cancelText="取消"
      >
        {resetTarget ? (
          <div className="modal-target">
            {resetTarget.name} · {resetTarget.username}
          </div>
        ) : null}
        <Form form={resetForm} layout="vertical" onFinish={submitReset}>
          <Form.Item
            name="password"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 6, message: '密码至少 6 位' },
            ]}
          >
            <Input.Password placeholder="至少 6 位" autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
