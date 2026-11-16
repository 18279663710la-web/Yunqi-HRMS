import { useEffect, useMemo, useState } from 'react';
import { App, Avatar, Button, DatePicker, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Tooltip, Upload } from 'antd';
import { LogoutOutlined, ReloadOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import dayjs, { type Dayjs } from 'dayjs';
import { fetchEmployeeOptions } from '../../employees/api';
import type { EmployeeOption } from '../../../types';
import { initialOf } from '../../../utils/helpers';
import { SubModuleHeader } from '../../../components/SubModuleHeader';
import {
  cancelDepartureRecord,
  reinstateDeparture,
  downloadDepartureFile,
  getDepartureFiles,
  getDepartures,
  registerDeparture,
  type DepartureFile,
  type DepartureRecord,
} from '../api';

const avatarStyle = { background: '#3D6EF7', color: '#fff', fontWeight: 600 } as const;

function positionTag(position: string) {
  const color = position === '研发员' ? '#8BA6C1' : position === '业务员' ? '#C9A75C' : 'default';
  return <Tag color={color} bordered={false}>{position}</Tag>;
}

export function HrOffboarding({ onEmployeeChanged }: { onEmployeeChanged: () => Promise<void> }) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<DepartureRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [candidates, setCandidates] = useState<EmployeeOption[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>();
  const [lastDate, setLastDate] = useState<Dayjs | null>(null);
  const [reinstateTarget, setReinstateTarget] = useState<DepartureRecord>();
  const [reinstateDate, setReinstateDate] = useState<Dayjs | null>(null);
  const [note, setNote] = useState('');
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [filesOpen, setFilesOpen] = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);
  const [files, setFiles] = useState<DepartureFile[]>([]);
  const [filesTarget, setFilesTarget] = useState<DepartureRecord>();

  const load = async () => {
    setLoading(true);
    try {
      setRows(await getDepartures());
    }
    catch (error) { message.error((error as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const employeeOptions = useMemo(() => {
    const busy = new Set(rows.map((row) => row.employeeId));
    return candidates
      .filter((employee) => !busy.has(employee.id))
      .map((employee) => ({
        value: employee.id,
        valueText: `${employee.name} ${employee.employeeNo}`,
        searchText: [employee.name, employee.employeeNo, employee.phone, employee.loginName]
          .filter(Boolean)
          .join(' ')
          .toLowerCase(),
        label: (
          <span className="departure-option">
            <Avatar size={28} style={avatarStyle}>{initialOf(employee.name)}</Avatar>
            <span className="departure-option-body">
              <span className="departure-option-name">{employee.name}</span>
              <span className="departure-option-meta">{employee.employeeNo || '—'} · {employee.position || '—'} · {employee.deptName || '未分配'}</span>
            </span>
          </span>
        ),
      }));
  }, [candidates, rows]);

  const openResign = async () => {
    setOpen(true);
    setSelectedEmployeeId(undefined);
    setLastDate(null);
    setNote('');
    setFileList([]);
    try {
      setCandidates(await fetchEmployeeOptions());
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const submit = async () => {
    if (!selectedEmployeeId) { message.warning('请选择员工'); return; }
    if (!lastDate) { message.warning('请选择离职日期'); return; }
    setSaving(true);
    try {
      const uploadFiles: File[] = [];
      for (const item of fileList) {
        const file = item.originFileObj;
        if (file) uploadFiles.push(file as File);
      }
      const result = await registerDeparture({ employeeId: selectedEmployeeId, lastDate: lastDate.format('YYYY-MM-DD'), note: note.trim() }, uploadFiles);
      message.success(result.status === 'departed' ? '已登记离职并锁定账号' : '已登记离职申请');
      setOpen(false);
      await load();
      try { await onEmployeeChanged(); } catch { message.warning('员工列表刷新失败，请刷新页面'); }
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (record: DepartureRecord) => {
    setLoading(true);
    try {
      await cancelDepartureRecord(record.id);
      message.success('已撤销离职申请');
      await load();
      try { await onEmployeeChanged(); } catch { message.warning('员工列表刷新失败，请刷新页面'); }
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const submitReinstate = async () => {
    if (!reinstateTarget) return;
    if (!reinstateDate) { message.warning('请选择复职日期'); return; }
    setSaving(true);
    try {
      const result = await reinstateDeparture(reinstateTarget.id, reinstateDate.format('YYYY-MM-DD'));
      message.success(result.status === 'pending_reinstatement' ? '已设为待复职' : '已复职');
      setReinstateTarget(undefined);
      await load();
      try { await onEmployeeChanged(); } catch { message.warning('员工列表刷新失败，请刷新页面'); }
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const openFiles = async (record: DepartureRecord) => {
    setFilesTarget(record);
    setFilesOpen(true);
    setFilesLoading(true);
    try { setFiles(await getDepartureFiles(record.id)); }
    catch (error) { message.error((error as Error).message); }
    finally { setFilesLoading(false); }
  };

  return <div className="onboarding-page departure-page">
    <SubModuleHeader title="离职管理" />
    <div className="filter-bar" role="toolbar" aria-label="离职管理操作">
      <Tooltip title="离职" arrow={false} overlayClassName="app-tooltip">
        <Button className="filter-circle" type="text" aria-label="离职" icon={<LogoutOutlined />} onClick={() => void openResign()} />
      </Tooltip>
      <Tooltip title="刷新" arrow={false} overlayClassName="app-tooltip">
        <Button className="filter-circle" type="text" aria-label="刷新" icon={<ReloadOutlined />} onClick={() => void load()} />
      </Tooltip>
    </div>
    <Table
      rowKey="id"
      dataSource={rows}
      loading={loading}
      pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (value) => `共 ${value} 条` }}
      tableLayout="fixed"
      scroll={{ x: 930 }}
      columns={[
        {
          title: '员工',
          dataIndex: 'name',
          width: 180,
          render: (_: unknown, row: DepartureRecord) => (
            <Space>
              <Avatar style={avatarStyle}>{initialOf(row.name)}</Avatar>
              <div>
                <div className="table-primary">{row.name}</div>
                <span className="table-secondary">{row.employeeNo}</span>
              </div>
            </Space>
          ),
        },
        { title: '职务', dataIndex: 'position', width: 120, render: (value: string) => positionTag(value) },
        { title: '离职日期', dataIndex: 'lastDate', width: 130, render: (value: string) => dayjs(value).format('YYYY-MM-DD') },
        {
          title: '状态',
          width: 100,
          render: (_: unknown, row: DepartureRecord) => {
            if (row.status === 'applied') return <Tag color="processing">已申请</Tag>;
            if (row.status === 'pending_reinstatement') {
              return <span><Tag color="#C9A75C">待复职</Tag>{row.reinstatementDate ? <div className="table-secondary">{row.reinstatementDate}</div> : null}</span>;
            }
            return <Tag>已离职</Tag>;
          },
        },
        {
          title: '附件',
          width: 140,
          render: (_: unknown, row: DepartureRecord) => row.fileCount
            ? <Button type="link" size="small" style={{ padding: 0 }} onClick={() => void openFiles(row)}>{row.fileCount} 个</Button>
            : '—',
        },
        { title: '备注', dataIndex: 'note', width: 160, ellipsis: true, render: (value: string) => value || '—' },
        {
          title: '操作',
          width: 100,
          render: (_: unknown, row: DepartureRecord) => row.status === 'applied' ? (
            <Popconfirm title="撤销离职申请？" onConfirm={() => void cancel(row)} okText="撤销" cancelText="返回">
              <Button type="link" size="small">撤销</Button>
            </Popconfirm>
          ) : row.status === 'departed' ? (
            <Button type="link" size="small" onClick={() => { setReinstateTarget(row); setReinstateDate(null); }}>复职</Button>
          ) : '—',
        },
      ]}
    />

    <Modal
      className="departure-modal"
      title="离职"
      open={open}
      onCancel={() => !saving && setOpen(false)}
      onOk={() => void submit()}
      confirmLoading={saving}
      okText="确认"
      cancelText="取消"
      width={560}
      destroyOnHidden
    >
      <Form layout="vertical" className="departure-form">
        <Form.Item label="员工" required>
          <Select
            showSearch
            allowClear
            value={selectedEmployeeId}
            onChange={(value) => setSelectedEmployeeId(value)}
            placeholder="搜索姓名、工号、手机号、登录名"
            optionLabelProp="valueText"
            style={{ width: '100%' }}
            notFoundContent="没有匹配的在职员工"
            filterOption={(input, option) => String(option?.searchText ?? '').includes(input.trim().toLowerCase())}
            options={employeeOptions}
          />
        </Form.Item>
        <Form.Item label="离职日期" required>
          <DatePicker style={{ width: '100%' }} value={lastDate} onChange={setLastDate} placeholder="请选择日期" />
        </Form.Item>
        <Form.Item label="备注">
          <Input.TextArea maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} rows={2} placeholder="可选" />
        </Form.Item>
        <Form.Item label="附件" extra={fileList.length ? undefined : '可选，最多 5 个，单个不超过 10MB'} className="departure-upload-item">
          <Upload
            beforeUpload={() => false}
            fileList={fileList}
            onChange={({ fileList: next }) => setFileList(next.slice(0, 5))}
            multiple
            maxCount={5}
          >
            <Button>选择文件</Button>
          </Upload>
        </Form.Item>
      </Form>
    </Modal>

    <Modal
      title="复职"
      open={Boolean(reinstateTarget)}
      onCancel={() => !saving && setReinstateTarget(undefined)}
      onOk={() => void submitReinstate()}
      confirmLoading={saving}
      okText="确认"
      cancelText="取消"
      destroyOnHidden
    >
      <Form layout="vertical">
        <Form.Item label="复职日期" required>
          <DatePicker
            style={{ width: '100%' }}
            value={reinstateDate}
            onChange={setReinstateDate}
            placeholder="请选择日期"
            disabledDate={(current) => Boolean(reinstateTarget && current && current.isBefore(dayjs(reinstateTarget.lastDate), 'day'))}
          />
        </Form.Item>
      </Form>
    </Modal>

    <Modal title={filesTarget ? `附件 · ${filesTarget.name}` : '附件'} open={filesOpen} onCancel={() => setFilesOpen(false)} footer={<Button onClick={() => setFilesOpen(false)}>关闭</Button>}>
      <Table
        rowKey="id"
        size="small"
        loading={filesLoading}
        pagination={false}
        dataSource={files}
        locale={{ emptyText: '暂无附件' }}
        columns={[
          { title: '文件名', dataIndex: 'name' },
          { title: '大小', width: 100, render: (_: unknown, file: DepartureFile) => `${Math.ceil(file.size / 1024)} KB` },
          {
            title: '操作',
            width: 90,
            render: (_: unknown, file: DepartureFile) => filesTarget
              ? <Button type="link" onClick={() => void downloadDepartureFile(filesTarget.id, file).catch((error: Error) => message.error(error.message))}>下载</Button>
              : null,
          },
        ]}
      />
    </Modal>
  </div>;
}
