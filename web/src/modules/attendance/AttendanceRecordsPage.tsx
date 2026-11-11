import { useEffect, useRef, useState } from 'react';
import {
  App as AntApp,
  Avatar,
  Button,
  Col,
  DatePicker,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  TimePicker,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EditOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';

import { fetchAttendance, saveAttendancePunch } from './api';
import { fetchEmployeeOptions } from '../employees/api';
import { fetchJobTitles, type JobTitle } from '../organization/api';
import { useWorkspaceActive } from '../../layout/WorkspaceContext';
import type {
  AdminAttendanceRecord,
  AttendanceResponse,
  EmployeeAttendanceSummary,
  EmployeeOption,
  JobCategoryName,
} from '../../types';
import {
  attendanceTag,
  downloadCsv,
  initialOf,
  jobCategoryTag,
} from '../../utils/helpers';

const { Text } = Typography;

interface PunchFormValues {
  date: Dayjs;
  checkIn?: Dayjs | null;
  checkOut?: Dayjs | null;
  statusOverride?: 'leave' | 'absent' | 'rest';
  note?: string;
}

const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'normal', label: '正常' },
  { value: 'missing_in', label: '未打上班卡' },
  { value: 'missing_out', label: '未打下班卡' },
  { value: 'absent', label: '缺卡' },
  { value: 'leave', label: '请假' },
  { value: 'rest', label: '休息' },
  { value: 'overtime', label: '加班' },
];

function toTimeValue(value: string): Dayjs | null {
  if (!value) return null;
  return dayjs(`2000-01-01 ${value}:00`);
}
const overtimeDuration = (seconds: number) => `${Math.floor(seconds / 3600)}小时${Math.floor(seconds % 3600 / 60)}分${seconds % 60}秒`;

export function AttendanceRecordsPage() {
  const { message } = AntApp.useApp();
  const active = useWorkspaceActive();
  const [jobTitles, setJobTitles] = useState<JobTitle[]>([]);
  const [month, setMonth] = useState<Dayjs>(dayjs().startOf('month'));
  const [day, setDay] = useState<Dayjs>(dayjs().startOf('day'));
  const [jobCategory, setJobCategory] = useState<JobCategoryName | undefined>(undefined);
  const [employeeId, setEmployeeId] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState('all');
  const [tab, setTab] = useState('detail');

  const [employeeOptions, setEmployeeOptions] = useState<EmployeeOption[]>([]);
  const [data, setData] = useState<AttendanceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  const [editOpen, setEditOpen] = useState(false);
  const [target, setTarget] = useState<AdminAttendanceRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<PunchFormValues>();

  const loadMeta = async () => {
    try {
      setEmployeeOptions(await fetchEmployeeOptions());
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  const load = async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setData(null);
    try {
      const result = await fetchAttendance({
          ...(tab === 'daily' ? { date: day.format('YYYY-MM-DD') } : { month: month.format('YYYY-MM') }),
          jobCategory,
          employeeId,
          status,
        });
      if (currentRequest === requestId.current) setData(result);
    } catch (err) {
      if (currentRequest === requestId.current) message.error((err as Error).message);
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    void loadMeta();
  }, []);

  useEffect(() => {
    if (!active) return;
    fetchJobTitles().then(setJobTitles).catch((error: Error) => message.error(error.message));
  }, [active]);

  useEffect(() => {
    if (active) void load();
  }, [month, day, tab, jobCategory, employeeId, status, active]);

  useEffect(() => {
    if (editOpen) {
      form.resetFields();
      if (target) {
        form.setFieldsValue({
          date: dayjs(target.date),
          checkIn: toTimeValue(target.checkIn),
          checkOut: toTimeValue(target.checkOut),
          statusOverride: target.statusOverride || undefined,
          note: target.note || '',
        });
      }
    }
  }, [editOpen, target, form]);

  const openEdit = (record: AdminAttendanceRecord) => {
    setTarget(record);
    setEditOpen(true);
  };

  const submitPunch = async (values: PunchFormValues) => {
    if (!target) return;
    setSaving(true);
    try {
      const checkIn = values.checkIn ? values.checkIn.format('HH:mm') : null;
      const checkOut = values.checkOut ? values.checkOut.format('HH:mm') : null;
      await saveAttendancePunch({
        employeeId: target.employeeId,
        date: values.date.format('YYYY-MM-DD'),
        checkIn,
        checkOut,
        statusOverride: values.statusOverride || null,
        note: values.note?.trim() || '',
      });
      message.success('考勤已更新');
      setEditOpen(false);
      await load();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const onPunchFormChange = (changed: Partial<PunchFormValues>) => {
    if ('checkIn' in changed || 'checkOut' in changed) {
      if (changed.checkIn || changed.checkOut) {
        form.setFieldValue('statusOverride', undefined);
      }
    }
    if ('statusOverride' in changed && changed.statusOverride) {
      form.setFieldsValue({ checkIn: null, checkOut: null });
    }
  };

  const exportCsv = () => {
    if (!data) return;
    if (tab === 'summary') {
      downloadCsv(`考勤月度汇总-${data.month}.csv`, [
        ['员工', '工号', '职务', '正常', '异常', '缺卡', '请假', '休息', '出差', '加班天数', '加班时长', '出勤天数', '累计工时'],
        ...data.employeeSummary.map((row) => [
          row.employeeName,
          row.employeeNo,
          row.jobCategory,
          row.normal,
          row.missingIn + row.missingOut,
          row.absent,
          row.leave,
          row.rest,
          row.travel,
          row.overtime,
          overtimeDuration(row.overtimeSeconds),
          row.presentDays,
          `${row.totalHours} h`,
        ]),
      ]);
      return;
    }
    downloadCsv(`考勤明细-${tab === 'daily' ? data.startDate : data.month}.csv`, [
      ['日期', '员工', '工号', '职务', '上班', '下班', '工时', '状态', '加班打卡', '加班时长', '备注'],
      ...data.list.map((row) => [
        row.date,
        row.employeeName,
        row.employeeNo,
        row.jobCategory,
        row.checkIn || '',
        row.checkOut || '',
        row.duration,
        row.statusText,
        row.overtimePeriods.map(item => `${item.checkIn} — ${item.checkOut || '未打卡'}`).join('；'),
        row.overtimeCount ? overtimeDuration(row.overtimeSeconds) : '',
        row.note || '',
      ]),
    ]);
  };

  const detailColumns: ColumnsType<AdminAttendanceRecord> = [
    {
      title: '日期',
      dataIndex: 'date',
      width: 130,
      render: (_, row) => (
        <div>
          <div className="table-primary">{row.date}</div>
          <Text type="secondary" className="table-secondary">
            {row.weekdayText}
            {row.isToday ? ' · 今天' : ''}
          </Text>
        </div>
      ),
    },
    {
      title: '员工',
      dataIndex: 'employeeName',
      width: 200,
      render: (_, row) => (
        <Space>
          <Avatar size={30} style={{ background: '#EAF0FF', color: '#3D6EF7', fontSize: 13 }}>
            {initialOf(row.employeeName)}
          </Avatar>
          <div>
            <div>{row.employeeName}</div>
            <Text type="secondary" className="table-secondary">{row.employeeNo}</Text>
          </div>
        </Space>
      ),
    },
    {
      title: '职务',
      dataIndex: 'jobCategory',
      width: 120,
      render: (category: JobCategoryName) => jobCategoryTag(category),
    },
    {
      title: '上班 / 下班',
      dataIndex: 'checkIn',
      width: 160,
      render: (_, row) => (
        <span className={row.checkIn ? '' : 'time-empty'}>
          {row.checkIn || '--:--'} — {row.checkOut || '--:--'}
        </span>
      ),
    },
    { title: '工时', dataIndex: 'duration', width: 90 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      render: (_, row) => <Space wrap>{attendanceTag(row.status, row.statusText)}{row.overtimeCount > 0 ? attendanceTag('overtime', '加班') : null}</Space>,
    },
    { title: '加班打卡', width: 210, render: (_, row) => row.overtimePeriods.length ? row.overtimePeriods.map(item => <div key={item.checkIn}>{item.checkIn} — {item.checkOut || '未打下班卡'}</div>) : '—' },
    { title: '加班时长', width: 150, render: (_, row) => row.overtimeCount ? overtimeDuration(row.overtimeSeconds) : '—' },
    {
      title: '备注',
      dataIndex: 'note',
      width: 160,
      ellipsis: true,
      render: (note: string) => note || '—',
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      fixed: 'right',
      render: (_, row) => (
        <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
          更正
        </Button>
      ),
    },
  ];

  const summaryColumns: ColumnsType<EmployeeAttendanceSummary> = [
    {
      title: '员工',
      dataIndex: 'employeeName',
      width: 180,
      render: (_, row) => (
        <div>
          <div className="table-primary">{row.employeeName}</div>
          <Text type="secondary" className="table-secondary">{row.employeeNo}</Text>
        </div>
      ),
    },
    { title: '职务', dataIndex: 'jobCategory', render: (category: JobCategoryName) => jobCategoryTag(category) },
    { title: '正常', dataIndex: 'normal' },
    { title: '异常', key: 'abnormal', render: (_, row) => row.missingIn + row.missingOut },
    { title: '缺卡', dataIndex: 'absent' },
    { title: '请假', dataIndex: 'leave' },
    { title: '休息', dataIndex: 'rest' },
    { title: '出差', dataIndex: 'travel' },
    { title: '加班天数', dataIndex: 'overtime' },
    { title: '加班时长', dataIndex: 'overtimeSeconds', render: (value: number) => overtimeDuration(value) },
    { title: '出勤天数', dataIndex: 'presentDays' },
    { title: '累计工时', dataIndex: 'totalHours', render: (value: number) => `${value} h` },
  ];

  const summary = data?.summary;

  return (
    <section className="attendance-records-page" aria-label="考勤明细">
      <div className="attendance-records-entries">
        <button className="attendance-records-entry" type="button" disabled={!data || (tab === 'summary' ? !data.employeeSummary.length : !data.list.length)} onClick={exportCsv}>{tab === 'summary' ? '导出月度汇总' : '导出明细'}</button>
        <button className="attendance-records-entry" type="button" disabled={loading} onClick={() => void load()}>刷新</button>
      </div>
      <div className="attendance-records-content">
          <div className="filter-bar">
          {tab === 'daily' ? (
            <DatePicker
              aria-label="选择考勤日期"
              allowClear={false}
              value={day}
              disabledDate={(value) => value.isAfter(dayjs(), 'day')}
              onChange={(value) => { if (value) setDay(value.startOf('day')); }}
              style={{ width: 150 }}
            />
          ) : (
            <DatePicker
              aria-label="选择考勤月份"
              picker="month"
              allowClear={false}
              value={month}
              onChange={(value) => { if (value) setMonth(value.startOf('month')); }}
              style={{ width: 140 }}
            />
          )}
          <Select<JobCategoryName>
            id="attendance-job-category"
            aria-label="筛选职务"
            style={{ width: 150 }}
            value={jobCategory}
            allowClear
            placeholder="全部职务"
            options={jobTitles.map(title => ({ value: title.name, label: title.name }))}
            onChange={setJobCategory}
          />
          <Select
            id="attendance-employee"
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="全部员工"
            style={{ width: 230 }}
            value={employeeId}
            options={employeeOptions.map((e) => ({
              value: e.id,
              label: `${e.name} · ${e.position}`,
            }))}
            onChange={(value) => setEmployeeId(value)}
          />
          <Select
            id="attendance-status"
            style={{ width: 150 }}
            value={status}
            options={STATUS_OPTIONS}
            onChange={(value) => setStatus(value)}
          />
          <div className="filter-count">
            {tab === 'daily' ? `统计日期：${data?.startDate || '—'}` : `统计范围：${data?.startDate || '—'} 至 ${data?.endDate || '—'}`}
          </div>
        </div>

        <Row gutter={[12, 12]} className="mini-stat-row">
          <Col xs={12} sm={8} lg={4}>
            <div className="mini-stat"><Statistic title="正常" value={(summary?.normal || 0) + (summary?.travel || 0)} valueStyle={{ color: '#16B364' }} /></div>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <div className="mini-stat"><Statistic title="异常" value={(summary?.missingIn ?? 0) + (summary?.missingOut ?? 0)} valueStyle={{ color: '#F79009' }} /></div>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <div className="mini-stat"><Statistic title="缺卡" value={summary?.absent || 0} valueStyle={{ color: '#F04438' }} /></div>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <div className="mini-stat"><Statistic title="请假" value={summary?.leave || 0} valueStyle={{ color: '#3D6EF7' }} /></div>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <div className="mini-stat"><Statistic title="休息" value={summary?.rest || 0} /></div>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <div className="mini-stat"><Statistic title="加班" value={summary?.overtime || 0} /></div>
          </Col>
        </Row>

        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'detail',
              label: `考勤明细${tab === 'detail' && data ? `（${data.list.length}）` : ''}`,
              children: (
                <Table
                  rowKey={(row) => `${row.employeeId}-${row.date}`}
                  loading={loading}
                  columns={detailColumns}
                  dataSource={data?.list || []}
                  scroll={{ x: 1100 }}
                  pagination={{
                    pageSize: 15,
                    showSizeChanger: true,
                    showTotal: (value) => `共 ${value} 条`,
                  }}
                />
              ),
            },
            {
              key: 'daily',
              label: '单日汇总',
              children: (
                <Table
                  rowKey={(row) => `${row.employeeId}-${row.date}`}
                  loading={loading}
                  columns={detailColumns}
                  dataSource={data?.list || []}
                  scroll={{ x: 1100 }}
                  pagination={{ pageSize: 15, showSizeChanger: true, showTotal: (value) => `共 ${value} 人` }}
                />
              ),
            },
            {
              key: 'summary',
              label: '月度汇总',
              children: (
                <Table
                  rowKey="employeeId"
                  loading={loading}
                  columns={summaryColumns}
                  dataSource={data?.employeeSummary || []}
                  scroll={{ x: 900 }}
                  pagination={{ pageSize: 15, showTotal: (value) => `共 ${value} 人` }}
                />
              ),
            },
          ]}
        />
      </div>

      <Modal
        title="考勤更正 / 补卡"
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
      >
        {target ? (
          <div className="modal-target">
            {target.employeeName} · {target.jobCategory} · {target.date}
          </div>
        ) : null}
        <Form form={form} layout="vertical" onFinish={submitPunch} onValuesChange={onPunchFormChange}>
          <Form.Item name="date" label="日期" rules={[{ required: true, message: '请选择日期' }]}>
            <DatePicker style={{ width: '100%' }} disabled />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="checkIn" label="上班时间">
                <TimePicker format="HH:mm" style={{ width: '100%' }} placeholder="未打卡" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="checkOut" label="下班时间">
                <TimePicker format="HH:mm" style={{ width: '100%' }} placeholder="未打卡" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="statusOverride"
            label="考勤状态"
            extra="填写打卡时间时状态自动按时间判定；如登记请假/缺卡/休息，请留空打卡时间并选择状态。"
          >
            <Select
              allowClear
              placeholder="正常（按打卡时间判定）"
              options={[
                { value: 'leave', label: '请假' },
                { value: 'absent', label: '缺卡' },
                { value: 'rest', label: '休息' },
              ]}
            />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} maxLength={200} placeholder="如：忘记打卡，主管确认后补录" showCount />
          </Form.Item>
          <div className="form-tip">
            保存规则：根据上下班打卡记录判断状态；无打卡时间且无状态时清空该日记录。
          </div>
        </Form>
      </Modal>
    </section>
  );
}
