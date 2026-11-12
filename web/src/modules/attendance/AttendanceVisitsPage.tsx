import { useEffect, useRef, useState } from 'react';
import {
  App as AntApp,
  Avatar,
  Button,
  DatePicker,
  Image,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { type Dayjs } from 'dayjs';

import { fetchVisitPhotoUrl, fetchVisits } from './api';
import { fetchEmployeeOptions } from '../employees/api';
import { useWorkspaceActive } from '../../layout/WorkspaceContext';
import type { AdminVisitRecord, AdminVisitResponse, EmployeeOption } from '../../types';
import { downloadCsv, initialOf } from '../../utils/helpers';

const { Text } = Typography;

function addressText(record: AdminVisitRecord): string {
  return [record.addressName, record.address]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(' · ');
}

export function AttendanceVisitsPage() {
  const { message } = AntApp.useApp();
  const active = useWorkspaceActive();
  const [month, setMonth] = useState<Dayjs>(dayjs().startOf('month'));
  const [employeeId, setEmployeeId] = useState<string | undefined>(undefined);
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [employeeOptions, setEmployeeOptions] = useState<EmployeeOption[]>([]);
  const [data, setData] = useState<AdminVisitResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  const [photoOpen, setPhotoOpen] = useState(false);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const objectUrls = useRef<string[]>([]);

  useEffect(() => {
    fetchEmployeeOptions().then(setEmployeeOptions).catch((error: Error) => message.error(error.message));
  }, []);

  const load = async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    try {
      const result = await fetchVisits({
        month: month.format('YYYY-MM'),
        employeeId,
        keyword,
        page,
        pageSize,
      });
      if (currentRequest === requestId.current) setData(result);
    } catch (error) {
      if (currentRequest === requestId.current) message.error((error as Error).message);
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (active) void load();
  }, [month, employeeId, keyword, page, pageSize, active]);

  const changeMonth = (value: Dayjs | null) => {
    if (!value) return;
    setMonth(value.startOf('month'));
    setPage(1);
  };

  const changeEmployee = (value: string | undefined) => {
    setEmployeeId(value);
    setPage(1);
  };

  const searchKeyword = (value: string) => {
    setKeyword(value.trim());
    setPage(1);
  };

  const exportCsv = async () => {
    try {
      const result = await fetchVisits({
        month: month.format('YYYY-MM'),
        employeeId,
        keyword,
        page: 1,
        pageSize: 5000,
      });
      downloadCsv(`拜访记录-${result.startDate}-${result.endDate}.csv`, [
        ['拜访时间', '员工', '工号', '职务', '客户名称', '拜访目的', '拜访地点', '备注'],
        ...result.list.map((row) => [
          row.visitTime,
          row.employeeName,
          row.employeeNo,
          row.position,
          row.customerName,
          row.purpose,
          addressText(row),
          row.remark,
        ]),
      ]);
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const openPhotos = async (record: AdminVisitRecord) => {
    if (!record.photoIds.length) return;
    setPhotoOpen(true);
    setPhotoLoading(true);
    setPhotoUrls([]);
    const urls: string[] = [];
    try {
      for (const id of record.photoIds) urls.push(await fetchVisitPhotoUrl(id));
      objectUrls.current = urls;
      setPhotoUrls(urls);
    } catch (error) {
      urls.forEach((url) => URL.revokeObjectURL(url));
      message.error((error as Error).message);
      setPhotoOpen(false);
    } finally {
      setPhotoLoading(false);
    }
  };

  const closePhotos = () => {
    setPhotoOpen(false);
    setPhotoUrls([]);
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.current = [];
  };

  const columns: ColumnsType<AdminVisitRecord> = [
    {
      title: '拜访时间',
      dataIndex: 'visitTime',
      width: 150,
      render: (value: string) => value.slice(0, 16),
    },
    {
      title: '员工',
      width: 180,
      render: (_, record) => (
        <Space size={8}>
          <Avatar size="small">{initialOf(record.employeeName)}</Avatar>
          <span>
            <div>{record.employeeName}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>{record.employeeNo}</Text>
          </span>
        </Space>
      ),
    },
    {
      title: '职务',
      dataIndex: 'position',
      width: 110,
      render: (value: string) => value ? <Tag>{value}</Tag> : '—',
    },
    { title: '客户名称', dataIndex: 'customerName', width: 160, ellipsis: true },
    { title: '拜访目的', dataIndex: 'purpose', width: 180, ellipsis: true },
    {
      title: '拜访地点',
      width: 260,
      ellipsis: true,
      render: (_, record) => <span title={addressText(record)}>{addressText(record) || '—'}</span>,
    },
    {
      title: '照片',
      width: 110,
      render: (_, record) => record.photoCount
        ? <Button type="link" size="small" style={{ padding: 0 }} onClick={() => void openPhotos(record)}>查看 {record.photoCount} 张</Button>
        : '—',
    },
    { title: '备注', dataIndex: 'remark', ellipsis: true, render: (value: string) => value || '—' },
  ];

  return (
    <section className="attendance-records-page" aria-label="拜访记录">
      <div className="attendance-records-entries">
        <button className="attendance-records-entry" type="button" disabled={!data?.list.length} onClick={() => void exportCsv()}>导出记录</button>
        <button className="attendance-records-entry" type="button" disabled={loading} onClick={() => void load()}>刷新</button>
      </div>
      <div className="attendance-records-content">
        <div className="filter-bar">
          <DatePicker
            aria-label="选择拜访月份"
            picker="month"
            allowClear={false}
            value={month}
            disabledDate={(value) => value.isAfter(dayjs(), 'month')}
            onChange={changeMonth}
            style={{ width: 140 }}
          />
          <Select
            id="visit-employee"
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="全部员工"
            style={{ width: 230 }}
            value={employeeId}
            options={employeeOptions.map((employee) => ({
              value: employee.id,
              label: `${employee.name} · ${employee.position}`,
            }))}
            onChange={changeEmployee}
          />
          <Input.Search
            aria-label="搜索客户、目的或地址"
            allowClear
            placeholder="客户 / 目的 / 地址"
            style={{ width: 260 }}
            value={keywordInput}
            onChange={(event) => {
              setKeywordInput(event.target.value);
              if (!event.target.value) searchKeyword('');
            }}
            onSearch={searchKeyword}
          />
          <div className="filter-count">
            统计范围：{data?.startDate || '—'} 至 {data?.endDate || '—'}
          </div>
        </div>

        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={data?.list || []}
          scroll={{ x: 1250 }}
          pagination={{
            current: page,
            pageSize,
            total: data?.total || 0,
            showSizeChanger: true,
            showTotal: (value) => `共 ${value} 条`,
            onChange: (nextPage, nextSize) => {
              setPage(nextPage);
              setPageSize(nextSize);
            },
          }}
        />
      </div>

      <Modal
        title="现场照片"
        open={photoOpen}
        onCancel={closePhotos}
        footer={null}
        width={620}
        destroyOnClose
      >
        {photoLoading ? <div style={{ padding: '40px 0', textAlign: 'center', color: '#9AA1AC' }}>照片加载中…</div> : null}
        {!photoLoading && photoUrls.length ? (
          <Image.PreviewGroup>
            <Space wrap size={12}>
              {photoUrls.map((url, index) => (
                <Image
                  key={`${url}-${index}`}
                  src={url}
                  width={180}
                  height={140}
                  style={{ objectFit: 'cover', borderRadius: 8 }}
                />
              ))}
            </Space>
          </Image.PreviewGroup>
        ) : null}
      </Modal>
    </section>
  );
}
