import { useEffect, useMemo, useState } from 'react';
import {
  App,
  Button,
  Checkbox,
  DatePicker,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { type Dayjs } from 'dayjs';

import type { CompanyCalendarMode, CompanyCalendarRule, CompanyCalendarRuleInput } from '../../../types';
import { expandDateRanges, mergeDatesToRanges, type DateRangeValue } from './calendarDates';
import {
  createCompanyCalendarRule,
  deleteCompanyCalendarRule,
  fetchCompanyCalendarRules,
  updateCompanyCalendarRule,
} from './api';

const WEEKDAY_OPTIONS = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 0, label: '周日' },
];

const WEEKDAY_LABELS: Record<number, string> = Object.fromEntries(WEEKDAY_OPTIONS.map((item) => [item.value, item.label]));

interface CalendarFormValues {
  name: string;
  mode: CompanyCalendarMode;
  weeklyRestDays?: number[];
  cycleWeeks?: number;
  cycleRestDays?: number[][];
  anchorDate?: Dayjs;
  restRanges?: DateRangeValue[];
  workRanges?: DateRangeValue[];
}

function formatWeekdays(days: number[]): string {
  if (!days.length) return '无';
  return [...days]
    .sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b))
    .map((day) => WEEKDAY_LABELS[day] || '')
    .join('、');
}

function ruleSummary(rule: CompanyCalendarRule): string {
  if (rule.mode === 'weekly') return `每周休 ${formatWeekdays(rule.weeklyRestDays)}`;
  if (rule.mode === 'cycle') {
    const weeks = rule.cycleRestDays.map((days, index) => `第${index + 1}周 ${formatWeekdays(days)}`).join('；');
    return `${rule.cycleWeeks ?? rule.cycleRestDays.length} 周轮换：${weeks}`;
  }
  return '不固定';
}

function currentMonday(): Dayjs {
  const today = dayjs();
  return today.subtract((today.day() + 6) % 7, 'day').startOf('day');
}

export function CompanyCalendar() {
  const { message } = App.useApp();
  const [form] = Form.useForm<CalendarFormValues>();
  const [rules, setRules] = useState<CompanyCalendarRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CompanyCalendarRule | null>(null);
  const [saving, setSaving] = useState(false);

  const mode = Form.useWatch('mode', form) as CompanyCalendarMode | undefined;
  const cycleWeeks = Form.useWatch('cycleWeeks', form) as number | undefined;
  const selected = rules.find((rule) => rule.id === selectedId) || null;
  const weeks = Math.max(1, Math.min(8, Number(cycleWeeks) || 2));

  const load = async () => {
    setLoading(true);
    setFailed(false);
    try {
      const list = await fetchCompanyCalendarRules();
      setRules(list);
      setSelectedId((current) => current && list.some((rule) => rule.id === current) ? current : null);
    } catch (error) {
      setFailed(true);
      message.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (mode !== 'cycle' || !open) return;
    const current = (form.getFieldValue('cycleRestDays') as number[][] | undefined) || [];
    if (current.length === weeks) return;
    form.setFieldValue('cycleRestDays', Array.from({ length: weeks }, (_, index) => current[index] ?? []));
  }, [mode, weeks, open]);

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({
      name: '',
      mode: 'weekly',
      weeklyRestDays: [6, 0],
      cycleWeeks: 2,
      cycleRestDays: [[6, 0], [0]],
      anchorDate: currentMonday(),
      restRanges: [],
      workRanges: [],
    });
    setOpen(true);
  };

  const openEdit = (rule: CompanyCalendarRule) => {
    setEditing(rule);
    form.setFieldsValue({
      name: rule.name,
      mode: rule.mode,
      weeklyRestDays: rule.weeklyRestDays,
      cycleWeeks: rule.cycleWeeks ?? 2,
      cycleRestDays: rule.cycleRestDays.length ? rule.cycleRestDays : [[6, 0], [0]],
      anchorDate: rule.anchorDate ? dayjs(rule.anchorDate) : currentMonday(),
      restRanges: mergeDatesToRanges(rule.restDates),
      workRanges: mergeDatesToRanges(rule.workDates),
    });
    setOpen(true);
  };

  const save = async (values: CalendarFormValues) => {
    const restDates = expandDateRanges(values.restRanges);
    const workDates = expandDateRanges(values.workRanges);
    if (restDates.length > 1000 || workDates.length > 1000) {
      message.warning('单类例外日期不能超过 1000 天');
      return;
    }
    const input: CompanyCalendarRuleInput = {
      name: values.name.trim(),
      mode: values.mode,
      weeklyRestDays: values.mode === 'weekly' ? values.weeklyRestDays || [] : [],
      cycleWeeks: values.mode === 'cycle' ? Number(values.cycleWeeks) : null,
      cycleRestDays: values.mode === 'cycle' ? (values.cycleRestDays || []).map((days) => days || []) : [],
      anchorDate: values.mode === 'cycle' && values.anchorDate ? values.anchorDate.format('YYYY-MM-DD') : null,
      restDates,
      workDates,
    };
    setSaving(true);
    try {
      if (editing) {
        await updateCompanyCalendarRule(editing.id, input);
        message.success('公司日历已保存');
      } else {
        const created = await createCompanyCalendarRule(input);
        message.success('公司日历已创建');
        setSelectedId(created.id);
      }
      setOpen(false);
      await load();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    try {
      await deleteCompanyCalendarRule(selected.id);
      message.success('公司日历已删除');
      setSelectedId(null);
      await load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const columns: ColumnsType<CompanyCalendarRule> = [
    { title: '规则名称', dataIndex: 'name', width: 180 },
    { title: '休息规则', render: (_value, rule) => ruleSummary(rule) },
    {
      title: '例外',
      width: 150,
      render: (_value, rule) => <Space size={4} wrap>
        {rule.restDates.length > 0 && <Tag color="blue">休息 {rule.restDates.length}</Tag>}
        {rule.workDates.length > 0 && <Tag color="orange">上班 {rule.workDates.length}</Tag>}
        {!rule.restDates.length && !rule.workDates.length && <Typography.Text type="secondary">—</Typography.Text>}
      </Space>,
    },
    { title: '使用考勤组', width: 110, render: (_value, rule) => `${rule.usageCount} 个` },
    { title: '更新时间', width: 160, render: (_value, rule) => rule.updatedAt || '—' },
  ];

  const table = useMemo(() => <Table<CompanyCalendarRule>
    rowKey="id"
    size="small"
    columns={columns}
    dataSource={rules}
    pagination={false}
    scroll={{ x: 860 }}
    rowSelection={{
      type: 'radio',
      selectedRowKeys: selectedId ? [selectedId] : [],
      onChange: (keys) => setSelectedId(Number(keys[0])),
    }}
  />, [rules, selectedId]);

  return <section className="company-calendar-page" aria-label="公司日历">
    <div className="company-calendar-entries">
      <button className="company-calendar-entry" type="button" disabled={loading || failed || saving} onClick={openCreate}>新建规则</button>
      <button className="company-calendar-entry" type="button" disabled={!selected || saving} onClick={() => selected && openEdit(selected)}>编辑</button>
      <Popconfirm title={`删除日历“${selected?.name ?? ''}”？`} description={selected?.usageCount ? '该日历正被考勤组使用，不能删除。' : undefined} okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => void remove()} disabled={!selected || saving || (selected?.usageCount ?? 0) > 0}>
        <button className="company-calendar-entry company-calendar-entry-danger" type="button" disabled={!selected || saving || (selected?.usageCount ?? 0) > 0}>删除</button>
      </Popconfirm>
    </div>
    <div className="company-calendar-content">
      <Spin spinning={loading}>
        {rules.length ? table : <Empty description={failed ? '加载失败' : '暂无公司日历'} />}
      </Spin>
    </div>

    <Modal
      title={editing ? '编辑公司日历' : '新建公司日历'}
      open={open}
      onCancel={() => setOpen(false)}
      onOk={() => form.submit()}
      confirmLoading={saving}
      okText="保存"
      cancelText="取消"
      width={720}
      destroyOnClose
      styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
    >
      <Form form={form} layout="vertical" onFinish={save}>
        <Form.Item name="name" label="规则名称" rules={[{ required: true, whitespace: true, max: 50, message: '请填写规则名称' }]}>
          <Input maxLength={50} placeholder="例如：双休日历、大小周日历" />
        </Form.Item>
        <Form.Item name="mode" label="休息模式" rules={[{ required: true }]}>
          <Radio.Group options={[{ value: 'none', label: '不固定' }, { value: 'weekly', label: '每周固定' }, { value: 'cycle', label: '按周轮换' }]} />
        </Form.Item>
        {mode === 'weekly' && (
          <Form.Item name="weeklyRestDays" label="每周休息日">
            <Checkbox.Group options={WEEKDAY_OPTIONS} />
          </Form.Item>
        )}
        {mode === 'cycle' && <>
          <Form.Item name="cycleWeeks" label="周期周数" rules={[{ required: true, message: '请设置周期周数' }]}>
            <InputNumber min={1} max={8} precision={0} style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="anchorDate" label="起始周（所选日期所在周为第 1 周）" rules={[{ required: true, message: '请选择起始周' }]}>
            <DatePicker style={{ width: 220 }} />
          </Form.Item>
          {Array.from({ length: weeks }).map((_, index) => (
            <Form.Item key={index} name={['cycleRestDays', index]} label={`第 ${index + 1} 周休息日`}>
              <Checkbox.Group options={WEEKDAY_OPTIONS} />
            </Form.Item>
          ))}
        </>}
        <Form.Item label="例外休息日期">
          <Form.List name="restRanges">
            {(fields, { add, remove }) => (
              <Space direction="vertical" style={{ width: '100%' }} size={8}>
                {fields.map(({ key, name }) => (
                  <Space key={key} align="start" style={{ width: '100%' }} size={8}>
                    <Form.Item name={name} style={{ flex: 1, marginBottom: 0 }} rules={[{ required: true, message: '请选择日期范围' }]}>
                      <DatePicker.RangePicker
                        allowEmpty={[false, false]}
                        format="YYYY-MM-DD"
                        placeholder={['开始日期', '结束日期']}
                        style={{ width: '100%' }}
                      />
                    </Form.Item>
                    <Button type="text" danger onClick={() => remove(name)}>删除</Button>
                  </Space>
                ))}
                <Button type="dashed" block onClick={() => add()}>添加日期范围</Button>
              </Space>
            )}
          </Form.List>
        </Form.Item>
        <Form.Item label="例外上班日期">
          <Form.List name="workRanges">
            {(fields, { add, remove }) => (
              <Space direction="vertical" style={{ width: '100%' }} size={8}>
                {fields.map(({ key, name }) => (
                  <Space key={key} align="start" style={{ width: '100%' }} size={8}>
                    <Form.Item name={name} style={{ flex: 1, marginBottom: 0 }} rules={[{ required: true, message: '请选择日期范围' }]}>
                      <DatePicker.RangePicker
                        allowEmpty={[false, false]}
                        format="YYYY-MM-DD"
                        placeholder={['开始日期', '结束日期']}
                        style={{ width: '100%' }}
                      />
                    </Form.Item>
                    <Button type="text" danger onClick={() => remove(name)}>删除</Button>
                  </Space>
                ))}
                <Button type="dashed" block onClick={() => add()}>添加日期范围</Button>
              </Space>
            )}
          </Form.List>
        </Form.Item>
      </Form>
    </Modal>
  </section>;
}
