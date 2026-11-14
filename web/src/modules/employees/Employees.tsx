import { useEffect, useState } from 'react';
import {
  App as AntApp,
  Avatar,
  Button,
  Col,
  DatePicker,
  Divider,
  Dropdown,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { MenuProps } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  DownOutlined,
  SearchOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { pinyin } from 'pinyin-pro';
import { useSearchParams } from 'react-router-dom';

import { createEmployee, fetchEmployees, resetEmployeeAccountPassword, setEmployeeAccountStatus, updateEmployee, upsertEmployeeAccount } from './api';
import type {
  AccountStatus,
  AdminEmployee,
  JobCategoryName,
} from '../../types';
import { accountStatusTag, initialOf } from '../../utils/helpers';
import { fetchJobTitles, fetchOrganizations, type JobTitle, type Organization } from '../organization/api';
import { useWorkspaceActive } from '../../layout/WorkspaceContext';
import { useAuth } from '../../auth/AuthContext';
import { deleteU9Binding, fetchU9Binding, fetchU9Operators, saveU9Binding, type U9Operator } from './u9Api';

const { Text } = Typography;

interface EmployeeFormValues {
  name: string;
  gender?: string;
  jobCategory?: JobCategoryName;
  deptId?: string;
  employeeNo: string;
  phone: string;
  email?: string;
  joinDate: Dayjs;
  isLeader?: boolean;
  withAccount?: boolean;
  loginName?: string;
  password?: string;
  accountStatus?: AccountStatus;
}

interface AccountFormValues {
  loginName: string;
  password: string;
  status: AccountStatus;
}

interface ResetFormValues {
  password: string;
}

export function EmployeesPage() {
  const { message, modal } = AntApp.useApp();
  const { admin } = useAuth();
  const active = useWorkspaceActive();
  const [jobTitles, setJobTitles] = useState<JobTitle[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();

  const [list, setList] = useState<AdminEmployee[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [keyword, setKeyword] = useState('');
  const [jobFilter, setJobFilter] = useState<JobCategoryName>();
  const [accountStatus, setAccountStatus] = useState<'all' | AccountStatus | 'none'>('all');


  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<AdminEmployee | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<EmployeeFormValues>();
  const withAccount = Form.useWatch('withAccount', form);

  const [accountOpen, setAccountOpen] = useState(false);
  const [accountTarget, setAccountTarget] = useState<AdminEmployee | null>(null);
  const [accountForm] = Form.useForm<AccountFormValues>();

  const [resetOpen, setResetOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<AdminEmployee | null>(null);
  const [resetForm] = Form.useForm<ResetFormValues>();

  const [u9Target, setU9Target] = useState<AdminEmployee | null>(null);
  const [u9Operators, setU9Operators] = useState<U9Operator[]>([]);
  const [u9Selected, setU9Selected] = useState<string>();
  const [u9Busy, setU9Busy] = useState(false);

  const openU9 = async (record: AdminEmployee) => {
    setU9Target(record); setU9Selected(undefined); setU9Operators([]); setU9Busy(true);
    try {
      const [operators, binding] = await Promise.all([fetchU9Operators(), fetchU9Binding(record.id)]);
      setU9Operators(binding && !operators.some(item => item.id === binding.id) ? [binding, ...operators] : operators);
      setU9Selected(binding?.id);
    } catch (error) { message.error((error as Error).message); }
    finally { setU9Busy(false); }
  };

  const load = async () => {
    setLoading(true);
    try {
      const result = await fetchEmployees({
        keyword,
        jobCategory: jobFilter,
        accountStatus,
        page,
        pageSize,
      });
      setList(result.list);
      setTotal(result.total);
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (active) void load();
  }, [page, pageSize, keyword, jobFilter, accountStatus, active]);

  useEffect(() => {
    if (!active) return;
    Promise.all([fetchJobTitles(), fetchOrganizations()]).then(([titles, items]) => { setJobTitles(titles); setOrganizations(items); }).catch((error: Error) => message.error(error.message));
  }, [active]);

  useEffect(() => {
    if (editOpen) {
      if (editing) {
        form.setFieldsValue({
          name: editing.name,
          deptId: editing.deptId,
          jobCategory: editing.position,
          gender: editing.gender || '男',
          employeeNo: editing.employeeNo,
          phone: editing.phone,
          email: editing.email,
          joinDate: dayjs(editing.joinDate),
          isLeader: editing.isLeader,
          withAccount: false,
        });
      } else {
        form.resetFields();
        form.setFieldsValue({
          gender: '男',
          deptId: 'D00',
          joinDate: dayjs(),
          isLeader: false,
          withAccount: true,
          accountStatus: 'active',
        });
      }
    }
  }, [editOpen, editing, form]);

  useEffect(() => {
    if (accountOpen) {
      accountForm.resetFields();
      accountForm.setFieldsValue({ status: 'active' });
    }
  }, [accountOpen, accountForm]);

  useEffect(() => {
    if (resetOpen) {
      resetForm.resetFields();
    }
  }, [resetOpen, resetForm]);

  const openCreate = () => {
    setEditing(null);
    setEditOpen(true);
  };

  useEffect(() => {
    if (searchParams.get('create') === '1') {
      openCreate();
      searchParams.delete('create');
      setSearchParams(searchParams, { replace: true });
    }
    // 只在首次进入时处理 ?create=1
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openEdit = (record: AdminEmployee) => {
    setEditing(record);
    setEditOpen(true);
  };

  const openAccount = (record: AdminEmployee) => {
    setAccountTarget(record);
    setAccountOpen(true);
  };

  const openReset = (record: AdminEmployee) => {
    setResetTarget(record);
    setResetOpen(true);
  };

  const submitEmployee = async (values: EmployeeFormValues) => {
    setSaving(true);
    try {
      const generatedPinyin = pinyin(values.name, { toneType: 'none', type: 'array' })
        .join('')
        .toLowerCase()
        .replace(/[^a-z]/g, '');
      if (!/^[a-z]+$/.test(generatedPinyin)) {
        message.error('姓名无法生成拼音');
        return;
      }
      const payload = {
        name: values.name.trim(),
        pinyin: generatedPinyin,
        gender: values.gender,
        deptId: values.deptId || 'D00',
        position: values.jobCategory || '员工',
        level: editing ? editing.level : '—',
        employeeNo: values.employeeNo.trim(),
        phone: values.phone.trim(),
        email: values.email?.trim() || '',
        joinDate: values.joinDate.format('YYYY-MM-DD'),
        isLeader: !!values.isLeader,
        jobCategory: values.jobCategory || '员工',
        seat: editing ? editing.seat : '',
        leaderId: editing ? editing.leaderId : '',
      };

      if (editing) {
        await updateEmployee(editing.id, payload);
        message.success('员工资料已更新');
      } else {
        await createEmployee({
          ...payload,
          account: values.withAccount
            ? {
                loginName: (values.loginName || '').trim(),
                password: values.password || '',
                status: values.accountStatus || 'active',
              }
            : undefined,
        });
        message.success('员工与账号已创建');
      }
      setEditOpen(false);
      await load();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const submitAccount = async (values: AccountFormValues) => {
    if (!accountTarget) return;
    setSaving(true);
    try {
      await upsertEmployeeAccount(accountTarget.id, {
        loginName: values.loginName.trim(),
        password: values.password,
        status: values.status,
      });
      message.success('登录账号已开通');
      setAccountOpen(false);
      await load();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const submitReset = async (values: ResetFormValues) => {
    if (!resetTarget) return;
    setSaving(true);
    try {
      await resetEmployeeAccountPassword(resetTarget.id, values.password);
      message.success('密码已重置');
      setResetOpen(false);
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggleAccount = (record: AdminEmployee) => {
    if (!record.account) return;
    const nextStatus = record.account.status === 'active' ? 'disabled' : 'active';
    modal.confirm({
      title: nextStatus === 'disabled' ? '停用登录账号' : '启用登录账号',
      content:
        nextStatus === 'disabled'
          ? `停用后，${record.name} 将无法使用该账号登录。员工档案与历史考勤不受影响。`
          : `启用后，${record.name} 可以重新使用该账号登录。`,
      okText: nextStatus === 'disabled' ? '确认停用' : '确认启用',
      okButtonProps: { danger: nextStatus === 'disabled' },
      cancelText: '取消',
      onOk: async () => {
        try {
          await setEmployeeAccountStatus(record.id, nextStatus);
          message.success(nextStatus === 'disabled' ? '账号已停用' : '账号已启用');
          await load();
        } catch (err) {
          message.error((err as Error).message);
        }
      },
    });
  };

  const menuFor = (record: AdminEmployee): MenuProps => ({
    items: [
      { key: 'edit', label: '编辑资料' },
      ...(admin?.role === 'super_admin' && record.position === '业务员' && record.employmentStatus !== 'departed' ? [{ key: 'u9', label: '绑定 U9 业务员' }] : []),
      record.account
        ? { key: 'reset', label: '重置登录密码' }
        : { key: 'create-account', label: '开通登录账号' },
      ...(record.account
        ? [
            {
              key: 'toggle',
              label: record.account.status === 'active' ? '停用登录账号' : '启用登录账号',
              danger: record.account.status === 'active',
            },
          ]
        : []),
    ],
    onClick: ({ key }) => {
      if (key === 'edit') openEdit(record);
      if (key === 'u9') void openU9(record);
      if (key === 'reset') openReset(record);
      if (key === 'create-account') openAccount(record);
      if (key === 'toggle') toggleAccount(record);
    },
  });

  const columns: ColumnsType<AdminEmployee> = [
    {
      title: '员工',
      dataIndex: 'name',
      width: 220,
      render: (_, record) => (
        <Space>
          <Avatar style={{ background: '#EAF0FF', color: '#3D6EF7', fontWeight: 600 }}>
            {initialOf(record.name)}
          </Avatar>
          <div>
            <div className="table-primary">
              {record.name}
              {record.isLeader ? <span className="leader-dot">负责人</span> : null}
              {record.employmentStatus === 'departed' ? <Tag color="default">已离职</Tag> : null}
            </div>
            <Text type="secondary" className="table-secondary">
              {record.employeeNo}
            </Text>
          </div>
        </Space>
      ),
    },
    {
      title: '职务',
      dataIndex: 'position',
      width: 150,
      render: (_, record) => {
        const color =
          record.jobCategory === '研发员' ? 'blue' : record.jobCategory === '业务员' ? 'orange' : 'default';
        return <Tag color={color} bordered={false}>{record.jobCategory}</Tag>;
      },
    },
    {
      title: '联系方式',
      dataIndex: 'phone',
      width: 190,
      render: (_, record) => (
        <div>
          <div>{record.phone}</div>
          <Text type="secondary" className="table-secondary">
            {record.email || '未填写邮箱'}
          </Text>
        </div>
      ),
    },
    {
      title: '入职日期',
      dataIndex: 'joinDate',
      width: 120,
    },
    {
      title: '登录账号',
      dataIndex: 'account',
      width: 210,
      render: (_, record) =>
        record.account ? (
          <div>
            <Space size={6}>
              {accountStatusTag(record.account.status)}
              <Text>{record.account.loginName}</Text>
            </Space>
            <div className="table-secondary">
              最近登录：{record.account.lastLoginAt || '从未登录'}
            </div>
          </div>
        ) : (
          <Space direction="vertical" size={2}>
            {accountStatusTag('none')}
            <Button type="link" size="small" style={{ padding: 0 }} onClick={() => openAccount(record)}>
              立即开通
            </Button>
          </Space>
        ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 100,
      fixed: 'right',
      render: (_, record) => (
        <Dropdown menu={menuFor(record)} trigger={['click']}>
          <Button size="small">
            管理 <DownOutlined />
          </Button>
        </Dropdown>
      ),
    },
  ];

  return (
    <div className="employees-page">
      <div className="salary-model-entries" role="toolbar" aria-label="员工与账号操作">
        <button type="button" className="salary-model-entry" onClick={() => { void load(); }}>刷新</button>
        <button type="button" className="salary-model-entry" onClick={openCreate}>新增员工账号</button>
      </div>

      <div className="filter-bar">
        <Input.Search
          allowClear
          aria-label="搜索员工"
          enterButton={<SearchOutlined />}
          placeholder="搜索姓名 / 拼音 / 工号 / 手机号 / 登录名"
          style={{ width: 'min(100%, 330px)' }}
          onSearch={(value) => {
            setPage(1);
            setKeyword(value.trim());
          }}
        />
        <Select
          style={{ width: 180, maxWidth: '100%' }}
          aria-label="筛选职务"
          value={jobFilter}
          allowClear
          placeholder="全部职务"
          options={jobTitles.map(title => ({ value: title.name, label: title.name }))}
          onChange={(value) => {
            setPage(1);
            setJobFilter(value);
          }}
        />
        <Select
          style={{ width: 160, maxWidth: '100%' }}
          aria-label="筛选账号状态"
          value={accountStatus}
          onChange={(value) => {
            setPage(1);
            setAccountStatus(value);
          }}
          options={[
            { value: 'all', label: '全部账号状态' },
            { value: 'active', label: '已启用' },
            { value: 'disabled', label: '已停用' },
            { value: 'none', label: '未开通' },
          ]}
        />
        <div className="filter-count">
          <TeamOutlined /> 共 {total} 人
        </div>
      </div>

      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={list}
        scroll={{ x: 1040 }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (value) => `共 ${value} 条`,
          onChange: (nextPage, nextPageSize) => {
            setPage(nextPage);
            setPageSize(nextPageSize);
          },
        }}
      />

      <Modal
        title={editing ? `编辑员工 · ${editing.name}` : '新增员工账号'}
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saving}
        okText={editing ? '保存修改' : '创建'}
        cancelText="取消"
        width={760}
        destroyOnClose={false}
      >
        <Form form={form} layout="vertical" onFinish={submitEmployee}>
          <Divider orientation="left" plain>员工信息</Divider>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="name"
                label="姓名"
                rules={[{ required: true, message: '请输入姓名' }]}
              >
                <Input placeholder="如：王小明" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="gender" label="性别">
                <Select options={[{ value: '男', label: '男' }, { value: '女', label: '女' }]} />
              </Form.Item>
            </Col>

              <Col span={8}>
                <Form.Item
                  name="jobCategory"
                  label="职务"
                  rules={[{ required: true, message: '请选择职务' }]}
                >
                  <Select
                    placeholder="请选择职务"
                    options={jobTitles.map(title => ({ value: title.name, label: title.name }))}
                  />
                </Form.Item>
              </Col>

            <Col span={8}>
              <Form.Item name="deptId" label="组织">
                <Select options={[{ value: 'D00', label: '未分配' }, ...organizations.map(item => ({ value: item.id, label: item.name }))]} />
              </Form.Item>
            </Col>


            <Col span={8}>
              <Form.Item name="employeeNo" label="工号" rules={[{ required: true, message: '请输入工号' }]}>
                <Input placeholder="如：YQ2026100" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="phone" label="手机号" rules={[{ required: true, message: '请输入手机号' }]}>
                <Input placeholder="11 位手机号" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="email"
                label="邮箱"
                rules={[{ type: 'email', message: '邮箱格式不正确' }]}
              >
                <Input placeholder="name@yunqi-tech.com" />
              </Form.Item>
            </Col>

            <Col span={8}>
              <Form.Item name="joinDate" label="入职日期" rules={[{ required: true, message: '请选择入职日期' }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="isLeader" label="组织负责人" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>

          {!editing ? (
            <>
              <Divider orientation="left" plain>登录账号</Divider>
              <Form.Item name="withAccount" label="同时开通小程序登录账号" valuePropName="checked">
                <Switch />
              </Form.Item>
              {withAccount ? (
                <Row gutter={16}>
                  <Col span={8}>
                    <Form.Item
                      name="loginName"
                      label="登录名"
                      rules={[
                        { required: true, message: '请输入登录名' },
                        {
                          pattern: /^[A-Za-z0-9_.-]{3,30}$/,
                          message: '3-30 位字母、数字、下划线、点或短横线',
                        },
                      ]}
                    >
                      <Input placeholder="如：wangxiaoming" autoComplete="off" />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
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
                  </Col>
                  <Col span={8}>
                    <Form.Item name="accountStatus" label="账号状态">
                      <Select
                        options={[
                          { value: 'active', label: '启用' },
                          { value: 'disabled', label: '停用' },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                </Row>
              ) : (
                <div className="form-tip">暂不开通账号也没关系，可稍后在列表中点「立即开通」。</div>
              )}
            </>
          ) : null}
        </Form>
      </Modal>

      <Modal
        title="开通登录账号"
        open={accountOpen}
        onCancel={() => setAccountOpen(false)}
        onOk={() => accountForm.submit()}
        confirmLoading={saving}
        okText="开通"
        cancelText="取消"
      >
        {accountTarget ? (
          <div className="modal-target">
            {accountTarget.name} · {accountTarget.deptName} · {accountTarget.employeeNo}
          </div>
        ) : null}
        <Form form={accountForm} layout="vertical" onFinish={submitAccount}>
          <Form.Item
            name="loginName"
            label="登录名"
            rules={[
              { required: true, message: '请输入登录名' },
              { pattern: /^[A-Za-z0-9_.-]{3,30}$/, message: '3-30 位字母、数字、下划线、点或短横线' },
            ]}
          >
            <Input placeholder="如：wangxiaoming" autoComplete="off" />
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
          <Form.Item name="status" label="账号状态">
            <Select
              options={[
                { value: 'active', label: '启用' },
                { value: 'disabled', label: '停用' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={u9Target ? `绑定 U9 业务员 · ${u9Target.name}` : '绑定 U9 业务员'}
        open={!!u9Target}
        onCancel={() => setU9Target(null)}
        onOk={async () => {
          if (!u9Target) return;
          setU9Busy(true);
          try {
            if (u9Selected) await saveU9Binding(u9Target.id, u9Selected);
            else await deleteU9Binding(u9Target.id);
            message.success(u9Selected ? '绑定已保存' : '绑定已解除'); setU9Target(null);
          } catch (error) { message.error((error as Error).message); }
          finally { setU9Busy(false); }
        }}
        confirmLoading={u9Busy}
        okText="保存"
        cancelText="取消"
      >
        <Select
          showSearch allowClear loading={u9Busy} style={{ width: '100%' }}
          placeholder="选择 U9 业务员" value={u9Selected} onChange={setU9Selected}
          optionFilterProp="label"
          options={u9Operators.map(item => ({ value: item.id, label: `${item.name} · ${item.code} · ${item.orgName} · ${item.id}` }))}
        />
      </Modal>

      <Modal
        title="重置登录密码"
        open={resetOpen}
        onCancel={() => setResetOpen(false)}
        onOk={() => resetForm.submit()}
        confirmLoading={saving}
        okText="重置密码"
        cancelText="取消"
      >
        {resetTarget ? (
          <div className="modal-target">
            {resetTarget.name} · 登录名 {resetTarget.account?.loginName}
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
