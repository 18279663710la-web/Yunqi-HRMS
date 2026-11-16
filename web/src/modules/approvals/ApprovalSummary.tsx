import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, App, Badge, Button, DatePicker, Popover, Select, Table, Tooltip, Typography } from 'antd';
import { DownloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { type Dayjs } from 'dayjs';

import { useAuth } from '../../auth/AuthContext';
import type { AdminRole } from '../../types';
import { downloadCsv } from '../../utils/helpers';
import { FunnelIcon } from '../../layout/adminIcons';
import {
  getApprovalSummary,
  getApprovalSummaryFields,
  getApprovalSummaryOptions,
  getApprovalTypeOptions,
  type ApprovalSummary,
  type ApprovalSummaryField,
  type ApprovalSummaryGroup,
  type ApprovalSummaryOptions,
  type ApprovalSummaryRow,
} from './api';
import { APPROVAL_TYPES, APPROVAL_TYPE_DEFINITIONS } from './approvalTypeDefinitions';

const BUILTIN_OPTIONS = APPROVAL_TYPES.map(key => ({ value: key, label: `${APPROVAL_TYPE_DEFINITIONS[key].name}审批` }));
const GROUP_OPTIONS: Array<{ value: ApprovalSummaryGroup; label: string }> = [
  { value: 'month', label: '月份' },
  { value: 'organization', label: '组织' },
  { value: 'position', label: '职务' },
  { value: 'employee', label: '员工' },
];
const GROUP_LABELS: Record<ApprovalSummaryGroup, string> = { month: '月份', organization: '组织', position: '职务', employee: '员工' };
const DEFAULT_GROUPS: ApprovalSummaryGroup[] = ['month'];
const GROUP_VALUES = GROUP_OPTIONS.map(option => option.value);
const STORAGE_PREFIX = 'yunqi.approval-summary-filters.';

interface SummaryFilters {
  from: string;
  to: string;
  organization: string;
  position: string;
  employee: string;
  groups: ApprovalSummaryGroup[];
  fields: string[];
}

function defaultFilters(): SummaryFilters {
  return {
    from: dayjs().subtract(11, 'month').startOf('month').format('YYYY-MM-DD'),
    to: dayjs().format('YYYY-MM-DD'),
    organization: '',
    position: '',
    employee: '',
    groups: [...DEFAULT_GROUPS],
    fields: [],
  };
}

function isDateText(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = dayjs(value);
  return parsed.isValid() && parsed.format('YYYY-MM-DD') === value;
}

function readSavedFilters(type: string): SummaryFilters {
  const fallback = defaultFilters();
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + type);
    if (!raw) return fallback;
    const saved = JSON.parse(raw) as Partial<SummaryFilters>;
    const groups = Array.isArray(saved.groups) ? GROUP_VALUES.filter(group => saved.groups!.includes(group)) : [];
    const from = isDateText(saved.from) ? saved.from : fallback.from;
    const to = isDateText(saved.to) ? saved.to : fallback.to;
    return {
      from: from > to ? fallback.from : from,
      to: from > to ? fallback.to : to,
      organization: typeof saved.organization === 'string' ? saved.organization : '',
      position: typeof saved.position === 'string' ? saved.position : '',
      employee: typeof saved.employee === 'string' ? saved.employee : '',
      groups: groups.length ? groups : [...DEFAULT_GROUPS],
      fields: Array.isArray(saved.fields) ? saved.fields.filter((key): key is string => typeof key === 'string') : [],
    };
  } catch {
    return fallback;
  }
}

function writeSavedFilters(type: string, filters: SummaryFilters): void {
  try { localStorage.setItem(STORAGE_PREFIX + type, JSON.stringify(filters)); } catch { /* 存储不可用时忽略 */ }
}

function approvalRate(row: { total: number; approved: number }): string {
  return row.total ? `${((row.approved / row.total) * 100).toFixed(1)}%` : '—';
}

function formatSum(value: number | undefined, field: ApprovalSummaryField): string {
  if (value === undefined || Number.isNaN(value)) return '—';
  const text = value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return field.type === 'money' ? `¥${text}` : text;
}

function csvSum(value: number | undefined): string {
  return (value ?? 0).toFixed(2);
}

export function ApprovalSummaryView({ role }: { role: AdminRole | undefined }) {
  const { message } = App.useApp();
  const defaults = useMemo(defaultFilters, []);
  const [type, setType] = useState<string>(APPROVAL_TYPES[0]);
  const [filters, setFilters] = useState<SummaryFilters>(() => readSavedFilters(APPROVAL_TYPES[0]));
  const [typeOptions, setTypeOptions] = useState<Array<{ value: string; label: string }>>(BUILTIN_OPTIONS);
  const [options, setOptions] = useState<ApprovalSummaryOptions | null>(null);
  const [availableFields, setAvailableFields] = useState<ApprovalSummaryField[]>([]);
  const [data, setData] = useState<ApprovalSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterContentRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const requestId = useRef(0);
  const fieldsRequest = useRef(0);
  const popupContainer = () => (filterContentRef.current?.closest('.ant-popover') as HTMLElement | null) ?? document.body;

  useEffect(() => {
    let active = true;
    getApprovalTypeOptions().then(rows => {
      if (!active) return;
      const custom = rows.filter(row => row.custom && row.published).map(row => ({ value: row.key, label: row.name }));
      setTypeOptions([...BUILTIN_OPTIONS, ...custom]);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    getApprovalSummaryOptions().then(result => { if (active) setOptions(result); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const runQuery = async (targetType: string, targetFilters: SummaryFilters): Promise<void> => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const result = await getApprovalSummary({
        type: targetType,
        from: targetFilters.from,
        to: targetFilters.to,
        organization: targetFilters.organization || undefined,
        position: targetFilters.position || undefined,
        employee: targetFilters.employee || undefined,
        groups: targetFilters.groups.join(','),
        fields: targetFilters.fields.join(','),
      });
      if (id !== requestId.current) return;
      setData(result);
      setAvailableFields(result.availableFields);
    } catch (error) {
      if (id !== requestId.current) return;
      setData(null);
      message.error((error as Error).message || '查询审批汇总失败');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (role !== 'super_admin' || initialized.current) return;
    initialized.current = true;
    void (async () => {
      let fields: ApprovalSummaryField[] = [];
      try { fields = (await getApprovalSummaryFields(type)).fields; } catch { /* 字段读取失败时仍可查询计数 */ }
      setAvailableFields(fields);
      const saved = readSavedFilters(type);
      const next = { ...saved, fields: saved.fields.filter(key => fields.some(field => field.key === key)) };
      setFilters(next);
      void runQuery(type, next);
    })();
  }, [role]);

  if (role !== 'super_admin') return <Alert type="warning" message="仅超级管理员可访问审批汇总" />;

  const employeeOptions = useMemo(() => (options?.employees ?? [])
    .filter(item => (!filters.organization || item.organizationId === filters.organization) && (!filters.position || item.position === filters.position))
    .map(item => ({ value: item.id, label: `${item.name} · ${item.position}` })), [options, filters.organization, filters.position]);

  const filtered = filters.organization !== '' || filters.position !== ''
    || filters.employee !== '' || filters.fields.length > 0
    || filters.groups.join(',') !== DEFAULT_GROUPS.join(',')
    || filters.from !== defaults.from || filters.to !== defaults.to;

  const updateFilters = (patch: Partial<SummaryFilters>) => setFilters(current => ({ ...current, ...patch }));

  const changeType = (next: string) => {
    if (next === type) return;
    requestId.current += 1;
    setLoading(false);
    setType(next);
    setData(null);
    const saved = readSavedFilters(next);
    setFilters(saved);
    setAvailableFields([]);
    const id = ++fieldsRequest.current;
    void getApprovalSummaryFields(next).then(result => {
      if (id !== fieldsRequest.current) return;
      setAvailableFields(result.fields);
      setFilters(current => ({ ...current, fields: current.fields.filter(key => result.fields.some(field => field.key === key)) }));
    }).catch(() => {
      if (id !== fieldsRequest.current) return;
      setAvailableFields([]);
      setFilters(current => ({ ...current, fields: [] }));
    });
  };
  const changeFrom = (value: Dayjs | null) => {
    if (!value) return;
    const next = value.format('YYYY-MM-DD');
    setFilters(current => ({ ...current, from: next, to: current.to < next ? next : current.to }));
  };
  const changeTo = (value: Dayjs | null) => {
    if (!value) return;
    const next = value.format('YYYY-MM-DD');
    setFilters(current => ({ ...current, from: current.from > next ? next : current.from, to: next }));
  };
  const saveFilters = () => {
    writeSavedFilters(type, filters);
    message.success('筛选条件已保存');
    setFilterOpen(false);
  };

  const fieldOptions = availableFields.map(field => ({ value: field.key, label: field.label }));

  const exportCsv = () => {
    if (!data?.rows.length) return;
    const groupColumns = data.groups.map(group => GROUP_LABELS[group]);
    const selectedFields = data.selectedFields;
    downloadCsv(`审批汇总-${data.typeName}-${data.from}_${data.to}.csv`, [
      [...groupColumns, '申请总数', '待审批', '已通过', '已驳回', '已撤销', '通过率', ...selectedFields.map(field => `${field.label}合计`)],
      ...data.rows.map(row => [
        ...data.groups.map(group => row[group] ?? ''),
        row.total,
        row.pending,
        row.approved,
        row.rejected,
        row.cancelled,
        approvalRate(row),
        ...selectedFields.map(field => csvSum(row.sums[field.key])),
      ]),
      [
        '合计',
        ...data.groups.slice(1).map(() => ''),
        data.totals.total,
        data.totals.pending,
        data.totals.approved,
        data.totals.rejected,
        data.totals.cancelled,
        approvalRate(data.totals),
        ...selectedFields.map(field => csvSum(data.totals.sums[field.key])),
      ],
    ]);
  };

  const columns: ColumnsType<ApprovalSummaryRow> = [
    ...(data?.groups ?? DEFAULT_GROUPS).map(group => ({
      title: GROUP_LABELS[group],
      dataIndex: group,
      key: group,
      width: group === 'month' ? 110 : 140,
      render: (value: string | undefined) => value || '—',
    })),
    { title: '申请总数', dataIndex: 'total', key: 'total', width: 100, align: 'right' as const },
    { title: '待审批', dataIndex: 'pending', key: 'pending', width: 100, align: 'right' as const },
    { title: '已通过', dataIndex: 'approved', key: 'approved', width: 100, align: 'right' as const },
    { title: '已驳回', dataIndex: 'rejected', key: 'rejected', width: 100, align: 'right' as const },
    { title: '已撤销', dataIndex: 'cancelled', key: 'cancelled', width: 100, align: 'right' as const },
    { title: '通过率', key: 'rate', width: 100, align: 'right' as const, render: (_: unknown, row: ApprovalSummaryRow) => approvalRate(row) },
    ...(data?.selectedFields ?? []).map(field => ({
      title: `${field.label}合计`,
      key: `sum-${field.key}`,
      width: 150,
      align: 'right' as const,
      render: (_: unknown, row: ApprovalSummaryRow) => formatSum(row.sums[field.key], field),
    })),
  ];
  const tableWidth = Math.max(760, (data?.groups.length ?? 1) * 140 + 600 + (data?.selectedFields.length ?? 0) * 150);

  const filterContent = <div ref={filterContentRef} className="filter-popover" style={{ minWidth: 420, maxHeight: '70vh', overflowY: 'auto' }}>
    <div className="filter-popover-row">
      <span className="filter-popover-label">开始日期</span>
      <DatePicker aria-label="开始日期" allowClear={false} value={dayjs(filters.from)} disabledDate={value => value.isAfter(dayjs(), 'day')} onChange={changeFrom} getPopupContainer={popupContainer} style={{ flex: 1 }} />
    </div>
    <div className="filter-popover-row">
      <span className="filter-popover-label">结束日期</span>
      <DatePicker aria-label="结束日期" allowClear={false} value={dayjs(filters.to)} disabledDate={value => value.isAfter(dayjs(), 'day')} onChange={changeTo} getPopupContainer={popupContainer} style={{ flex: 1 }} />
    </div>
    <div className="filter-popover-row">
      <span className="filter-popover-label">组织</span>
      <Select
        aria-label="筛选组织"
        allowClear
        placeholder="全部组织"
        style={{ flex: 1 }}
        value={filters.organization || undefined}
        options={(options?.organizations ?? []).map(item => ({ value: item.id, label: item.name }))}
        onChange={value => updateFilters({ organization: value || '', employee: '' })}
        getPopupContainer={popupContainer}
      />
    </div>
    <div className="filter-popover-row">
      <span className="filter-popover-label">职务</span>
      <Select
        aria-label="筛选职务"
        allowClear
        placeholder="全部职务"
        style={{ flex: 1 }}
        value={filters.position || undefined}
        options={(options?.positions ?? []).map(name => ({ value: name, label: name }))}
        onChange={value => updateFilters({ position: value || '', employee: '' })}
        getPopupContainer={popupContainer}
      />
    </div>
    <div className="filter-popover-row">
      <span className="filter-popover-label">员工</span>
      <Select
        aria-label="筛选员工"
        allowClear
        showSearch
        optionFilterProp="label"
        placeholder="全部员工"
        style={{ flex: 1 }}
        value={filters.employee || undefined}
        options={employeeOptions}
        onChange={value => updateFilters({ employee: value || '' })}
        getPopupContainer={popupContainer}
      />
    </div>
    <div className="filter-popover-row">
      <span className="filter-popover-label">分组</span>
      <Select
        aria-label="汇总分组"
        mode="multiple"
        style={{ flex: 1 }}
        value={filters.groups}
        options={GROUP_OPTIONS}
        onChange={value => updateFilters({ groups: value.length ? value as ApprovalSummaryGroup[] : DEFAULT_GROUPS })}
        getPopupContainer={popupContainer}
      />
    </div>
    <div className="filter-popover-row">
      <span className="filter-popover-label">统计字段</span>
      <Select
        aria-label="统计字段"
        mode="multiple"
        allowClear
        style={{ flex: 1 }}
        value={filters.fields}
        options={fieldOptions}
        placeholder={fieldOptions.length ? '选择数字或金额字段' : '该类型没有可统计字段'}
        disabled={!fieldOptions.length}
        onChange={value => updateFilters({ fields: value })}
        getPopupContainer={popupContainer}
      />
    </div>
    <div className="filter-popover-actions">
      <Button onClick={() => setFilters(defaultFilters())}>重置筛选与汇总</Button>
      <Button className="approval-summary-save" onClick={saveFilters}>保存</Button>
    </div>
  </div>;

  return <section className="payroll-workflow-page approval-summary-page" aria-label="审批汇总">
    <div className="employee-records-header">
      <Typography.Title level={4} style={{ margin: 0 }}>审批汇总</Typography.Title>
      <Select
        className="module-title-picker"
        aria-label="审批类型"
        value={type}
        options={typeOptions}
        onChange={changeType}
        disabled={loading}
      />
    </div>
    <div className="filter-bar" role="toolbar" aria-label="审批汇总操作">
      <Popover
        arrow={false}
        trigger="click"
        placement="bottomLeft"
        overlayClassName="filter-popover-overlay"
        open={filterOpen}
        onOpenChange={setFilterOpen}
        content={filterContent}
      >
        <Button
          className="filter-circle filter-funnel"
          type="text"
          aria-label="筛选"
          icon={<Badge dot={filtered} color="#3D6EF7"><FunnelIcon /></Badge>}
        />
      </Popover>
      <Tooltip title="查询" arrow={false} overlayClassName="app-tooltip">
        <Button className="filter-circle" type="text" aria-label="查询" icon={<SearchOutlined />} disabled={loading} onClick={() => void runQuery(type, filters)} />
      </Tooltip>
      <div className="payroll-actions-right">
        <Tooltip title="导出汇总" arrow={false} overlayClassName="app-tooltip">
          <Button className="filter-circle" type="text" aria-label="导出汇总" icon={<DownloadOutlined />} disabled={!data?.rows.length} onClick={exportCsv} />
        </Tooltip>
      </div>
    </div>
    <Table
      rowKey={row => (data?.groups ?? DEFAULT_GROUPS).map(group => row[group] ?? '').join('|')}
      loading={loading}
      columns={columns}
      dataSource={data?.rows || []}
      pagination={false}
      scroll={{ x: tableWidth }}
      summary={() => data && data.rows.length ? <Table.Summary.Row>
        {(data.groups.length ? data.groups : DEFAULT_GROUPS).map((group, index) => (
          <Table.Summary.Cell key={group} index={index}>{index === 0 ? '合计' : ''}</Table.Summary.Cell>
        ))}
        <Table.Summary.Cell index={data.groups.length}><div style={{ textAlign: 'right' }}>{data.totals.total}</div></Table.Summary.Cell>
        <Table.Summary.Cell index={data.groups.length + 1}><div style={{ textAlign: 'right' }}>{data.totals.pending}</div></Table.Summary.Cell>
        <Table.Summary.Cell index={data.groups.length + 2}><div style={{ textAlign: 'right' }}>{data.totals.approved}</div></Table.Summary.Cell>
        <Table.Summary.Cell index={data.groups.length + 3}><div style={{ textAlign: 'right' }}>{data.totals.rejected}</div></Table.Summary.Cell>
        <Table.Summary.Cell index={data.groups.length + 4}><div style={{ textAlign: 'right' }}>{data.totals.cancelled}</div></Table.Summary.Cell>
        <Table.Summary.Cell index={data.groups.length + 5}><div style={{ textAlign: 'right' }}>{approvalRate(data.totals)}</div></Table.Summary.Cell>
        {data.selectedFields.map((field, index) => (
          <Table.Summary.Cell key={field.key} index={data.groups.length + 6 + index}><div style={{ textAlign: 'right' }}>{formatSum(data.totals.sums[field.key], field)}</div></Table.Summary.Cell>
        ))}
      </Table.Summary.Row> : null}
    />
  </section>;
}

export function ApprovalSummaryPage() {
  const { admin } = useAuth();
  return <ApprovalSummaryView role={admin?.role} />;
}
