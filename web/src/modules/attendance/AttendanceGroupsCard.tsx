import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  TimePicker,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { type Dayjs } from 'dayjs';

import type {
  AttendanceGroup,
  AttendanceGroupInput,
  AttendanceGroupsResponse,
  AttendanceSettings,
  DepartmentNode,
  EmployeeOption,
} from '../../types';
import {
  createAttendanceGroup,
  deleteAttendanceGroup,
  fetchAttendanceGroups,
  renameAttendanceGroup,
  saveAttendanceSettings,
  updateAttendanceGroup,
} from './api';
import { fetchDepartments } from '../organization/api';
import { createAttendanceMap, type MapPoint, type MapSdk } from './attendanceMap';

interface GroupFormValues {
  name?: string;
  startTime: Dayjs;
  inEndTime: Dayjs;
  endTime: Dayjs;
  outEndTime: Dayjs;
  restDates?: Dayjs[];
  address: string;
  latitude?: number;
  longitude?: number;
  radius: number;
}

interface AttendanceGroupsCardProps {
  employeeOptions: EmployeeOption[];
  onChanged?: () => void;
}

const DEFAULT_GROUP: AttendanceGroup = {
  id: 0,
  name: '默认考勤组',
  isDefault: true,
  startTime: '09:00',
  inEndTime: '09:50',
  endTime: '17:40',
  outEndTime: '19:50',
  restDates: [],
  address: '',
  floor: '',
  latitude: 23.1291,
  longitude: 113.2644,
  radius: 100,
  employeeIds: [],
  employeeCount: 0,
  createdAt: null,
  updatedAt: null,
};

function timeValue(value?: string | null): Dayjs | undefined {
  return value ? dayjs(`2000-01-01 ${value}:00`) : undefined;
}

function formValues(group: AttendanceGroup, withName: boolean): GroupFormValues {
  return {
    name: withName ? group.name : undefined,
    startTime: timeValue(group.startTime) as Dayjs,
    inEndTime: timeValue(group.inEndTime) as Dayjs,
    endTime: timeValue(group.endTime) as Dayjs,
    outEndTime: timeValue(group.outEndTime) as Dayjs,
    restDates: (group.restDates || []).map((date) => dayjs(date)),
    address: group.address,
    latitude: group.latitude,
    longitude: group.longitude,
    radius: group.radius,
  };
}

function MapPicker({ latitude, longitude, radius, onSelect }: {
  latitude?: number; longitude?: number; radius?: number; onSelect: (lat: number, lng: number) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const controller = useRef<ReturnType<typeof createAttendanceMap>>();
  const point = useRef<MapPoint>({ latitude, longitude, radius });
  point.current = { latitude, longitude, radius };
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const key = (import.meta.env.VITE_TENCENT_MAP_KEY as string | undefined)?.trim();

  useEffect(() => {
    if (!key || !element.current) return;
    let disposed = false;
    setStatus('loading');
    const timeout = window.setTimeout(() => { if (!disposed) setStatus('error'); }, 15000);
    const global = window as unknown as { TMap?: MapSdk };
    const script = document.createElement('script');
    const init = () => {
      if (disposed || !element.current) return;
      const sdk = global.TMap;
      if (!sdk) { setStatus('error'); return; }
      try {
        controller.current = createAttendanceMap(sdk, element.current, point.current, (lat, lng) => onSelectRef.current(lat, lng), () => {
          if (!disposed) { window.clearTimeout(timeout); setStatus('ready'); }
        });
      } catch { setStatus('error'); }
    };
    if (global.TMap) init();
    else {
      script.src = `https://map.qq.com/api/gljs?v=1.exp&key=${encodeURIComponent(key)}`;
      script.onload = init;
      script.onerror = () => { if (!disposed) setStatus('error'); };
      document.head.appendChild(script);
    }
    return () => { disposed = true; window.clearTimeout(timeout); script.remove(); controller.current?.destroy(); controller.current = undefined; };
  }, [key, attempt]);

  useEffect(() => {
    controller.current?.update({ latitude, longitude, radius });
  }, [latitude, longitude, radius]);

  if (!key) return <Alert type="warning" showIcon message="尚未配置腾讯地图 Key" description="请在 Web 环境中配置 VITE_TENCENT_MAP_KEY，重启后可在地图上选点；也可以手动填写 GCJ-02 坐标。" />;
  return <>
    {status === 'error' && <Alert type="error" showIcon message="地图加载失败，请检查网络和腾讯地图配置。" action={<Button size="small" onClick={() => setAttempt(value => value + 1)}>重试</Button>} />}
    <Spin spinning={status === 'loading'} tip="地图加载中">
      <div ref={element} style={{ width: '100%', height: 300, borderRadius: 8, marginBottom: 12 }} />
    </Spin>
  </>;
}

export function AttendanceGroupsCard({ employeeOptions, onChanged }: AttendanceGroupsCardProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<GroupFormValues>();
  const [data, setData] = useState<AttendanceGroupsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AttendanceGroup | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSelection, setPickerSelection] = useState<string[]>([]);
  const [pickerOrgs, setPickerOrgs] = useState<string[]>([]);
  const [pickerPositions, setPickerPositions] = useState<string[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [organizations, setOrganizations] = useState<Array<{ id: string; name: string }>>([]);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameGroup, setRenameGroup] = useState<AttendanceGroup | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);

  const latitude = Form.useWatch('latitude', form);
  const longitude = Form.useWatch('longitude', form);
  const radius = Form.useWatch('radius', form);
  const startTime = Form.useWatch('startTime', form);
  const endTime = Form.useWatch('endTime', form);

  const load = async (initial = false) => {
    if (initial) setLoading(true);
    setLoadError('');
    try {
      setData(await fetchAttendanceGroups());
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      if (initial) setLoading(false);
    }
  };

  useEffect(() => {
    void load(true);
  }, []);

  useEffect(() => {
    fetchDepartments()
      .then((nodes) => {
        const list: Array<{ id: string; name: string }> = [];
        const walk = (items: DepartmentNode[]) => {
          items.forEach((node) => {
            list.push({ id: node.id, name: node.name });
            if (node.children?.length) walk(node.children);
          });
        };
        walk(nodes);
        setOrganizations(list);
      })
      .catch(() => setOrganizations([]));
  }, []);

  const rows = useMemo(() => {
    if (!data) return [] as AttendanceGroup[];
    return [data.defaultGroup, ...data.groups].filter((group): group is AttendanceGroup => !!group);
  }, [data]);

  const employeeGroupMap = useMemo(() => {
    const map = new Map<string, AttendanceGroup>();
    (data?.groups || []).forEach((group) => group.employeeIds.forEach((id) => map.set(id, group)));
    return map;
  }, [data]);

  const positionOptions = useMemo(
    () => Array.from(new Set(employeeOptions.map((employee) => employee.position).filter(Boolean))).sort(),
    [employeeOptions]
  );

  const filteredPickerEmployees = useMemo(() => {
    const keyword = employeeSearch.trim().toLowerCase();
    return employeeOptions.filter((employee) => {
      if (pickerOrgs.length && !pickerOrgs.includes(employee.deptName)) return false;
      if (pickerPositions.length && !pickerPositions.includes(employee.position)) return false;
      if (!keyword) return true;
      return [employee.name, employee.employeeNo, employee.position, employee.deptName]
        .some((value) => String(value || '').toLowerCase().includes(keyword));
    });
  }, [employeeOptions, pickerOrgs, pickerPositions, employeeSearch]);

  const allOrgsSelected = organizations.length > 0 && pickerOrgs.length === organizations.length;
  const allPositionsSelected = positionOptions.length > 0 && pickerPositions.length === positionOptions.length;
  const filteredIds = filteredPickerEmployees.map((employee) => employee.id);
  const checkedFilteredCount = filteredIds.filter((id) => pickerSelection.includes(id)).length;
  const allFilteredChecked = filteredIds.length > 0 && checkedFilteredCount === filteredIds.length;
  const someFilteredChecked = checkedFilteredCount > 0 && !allFilteredChecked;

  const showCreate = () => {
    const base = data?.defaultGroup ?? DEFAULT_GROUP;
    setEditing(null);
    setSelectedEmployeeIds([]);
    form.setFieldsValue(formValues(base, false));
    setOpen(true);
  };

  const showEdit = (group: AttendanceGroup) => {
    setEditing(group);
    setSelectedEmployeeIds(group.isDefault ? [] : group.employeeIds);
    form.setFieldsValue(formValues(group, !group.isDefault));
    setOpen(true);
  };

  const openPicker = () => {
    setPickerSelection(selectedEmployeeIds);
    setPickerOrgs([]);
    setPickerPositions([]);
    setEmployeeSearch('');
    setPickerOpen(true);
  };

  const togglePicker = (employeeId: string, checked: boolean) => {
    setPickerSelection((current) => checked
      ? Array.from(new Set([...current, employeeId]))
      : current.filter((id) => id !== employeeId));
  };

  const toggleAllFiltered = (checked: boolean) => {
    setPickerSelection((current) => checked
      ? Array.from(new Set([...current, ...filteredIds]))
      : current.filter((id) => !filteredIds.includes(id)));
  };

  const openRename = (group: AttendanceGroup) => {
    setRenameGroup(group);
    setRenameValue(group.name);
    setRenameOpen(true);
  };

  const submitRename = async () => {
    if (!renameGroup) return;
    const name = renameValue.trim();
    if (!name) {
      message.warning('请输入考勤组名称');
      return;
    }
    setRenameSaving(true);
    try {
      await renameAttendanceGroup(renameGroup.id, name);
      message.success('考勤组名称已修改');
      setRenameOpen(false);
      await load(false);
      onChanged?.();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setRenameSaving(false);
    }
  };

  const save = async (values: GroupFormValues) => {
    if (values.latitude === undefined || values.longitude === undefined) {
      message.warning('请在地图上选点或填写经纬度');
      return;
    }
    const settings: AttendanceSettings = {
      startTime: values.startTime.format('HH:mm'),
      inEndTime: values.inEndTime.format('HH:mm'),
      endTime: values.endTime.format('HH:mm'),
      outEndTime: values.outEndTime.format('HH:mm'),
      restDates: (values.restDates || []).map((date) => date.format('YYYY-MM-DD')).sort(),
      address: values.address.trim(),
      floor: '',
      latitude: values.latitude,
      longitude: values.longitude,
      radius: values.radius,
    };

    setSaving(true);
    try {
      if (editing?.isDefault) {
        await saveAttendanceSettings(settings);
        message.success('默认考勤组已保存');
      } else {
        const input: AttendanceGroupInput = {
          ...settings,
          name: (values.name || '').trim(),
          employeeIds: selectedEmployeeIds,
        };
        if (editing) {
          await updateAttendanceGroup(editing.id, input);
          message.success('考勤组已保存');
        } else {
          await createAttendanceGroup(input);
          message.success('考勤组已创建');
        }
      }
      setOpen(false);
      await load(false);
      onChanged?.();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (group: AttendanceGroup) => {
    try {
      await deleteAttendanceGroup(group.id);
      message.success('考勤组已删除，组内员工将使用默认考勤组');
      await load(false);
      onChanged?.();
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  const columns: ColumnsType<AttendanceGroup> = [
    {
      title: '考勤组',
      dataIndex: 'name',
      width: 150,
      render: (_value, group) => (
        <Space size={6}>
          {group.isDefault
            ? <span>{group.name}</span>
            : <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} onClick={() => openRename(group)}>{group.name}</Button>}
          {group.isDefault && <Tag color="blue">默认</Tag>}
        </Space>
      ),
    },
    { title: '办公时间', width: 130, render: (_value, group) => `${group.startTime}–${group.endTime}` },
    {
      title: '打卡时段',
      width: 220,
      render: (_value, group) => `上班 ${group.startTime}–${group.inEndTime || '未设置'}；下班 ${group.endTime}–${group.outEndTime || '未设置'}`,
    },
    {
      title: '打卡地点',
      render: (_value, group) => `${group.address} · ${group.radius} 米`,
    },
    {
      title: '员工',
      width: 150,
      render: (_value, group) => group.isDefault
        ? `未分配员工（${group.employeeCount} 人）`
        : `${group.employeeCount} 人`,
    },
    {
      title: '操作',
      width: 140,
      render: (_value, group) => (
        <Space size={4}>
          <Button size="small" onClick={() => showEdit(group)}>编辑</Button>
          {!group.isDefault && (
            <Popconfirm
              title="删除考勤组？"
              description="组内员工将使用默认考勤组。"
              onConfirm={() => void remove(group)}
              okText="删除"
              cancelText="取消"
            >
              <Button size="small" danger>删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return <>
    <Card
      className="panel-card"
      bordered={false}
      loading={loading}
      title="考勤组"
      extra={<Space><Button onClick={() => void load(false)}>刷新考勤组</Button><Button type="primary" onClick={showCreate}>新建考勤组</Button></Space>}
    >
      {loadError && <Alert type="error" showIcon message={loadError} action={<Button size="small" onClick={() => void load(true)}>重试</Button>} style={{ marginBottom: 16 }} />}
      {!loadError && data && !data.defaultGroup && (
        <Alert
          type="warning"
          showIcon
          message="默认考勤组尚未设置"
          description="未分配考勤组的员工暂时无法打卡。"
          action={<Button size="small" onClick={() => showEdit(DEFAULT_GROUP)}>设置</Button>}
          style={{ marginBottom: 16 }}
        />
      )}
      <Table
        rowKey={(group) => group.isDefault ? 'default' : String(group.id)}
        columns={columns}
        dataSource={rows}
        pagination={false}
        size="small"
        scroll={{ x: 900 }}
      />
    </Card>

    <Modal
      title={editing?.isDefault ? '编辑默认考勤组' : editing ? '编辑考勤组' : '新建考勤组'}
      open={open}
      onCancel={() => setOpen(false)}
      onOk={() => form.submit()}
      confirmLoading={saving}
      okText="保存"
      cancelText="取消"
      width={760}
      destroyOnClose
      styles={{ body: { maxHeight: '68vh', overflowY: 'auto' } }}
    >
      <Form form={form} layout="vertical" onFinish={save}>
        {!editing?.isDefault && (
          <Form.Item name="name" label="考勤组名称" rules={[{ required: true, whitespace: true, max: 50, message: '请填写考勤组名称' }]}>
            <Input maxLength={50} placeholder="例如：生产部早班" />
          </Form.Item>
        )}
        <Row gutter={16}>
          <Col xs={12}><Form.Item name="startTime" label="上班时间" rules={[{ required: true, message: '请选择上班时间' }]}><TimePicker format="HH:mm" style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={12}><Form.Item name="endTime" label="下班时间" dependencies={['startTime']} rules={[{ required: true, message: '请选择下班时间' }, ({ getFieldValue }) => ({ validator(_, value: Dayjs) { return !value || !getFieldValue('startTime') || value.format('HH:mm') > (getFieldValue('startTime') as Dayjs).format('HH:mm') ? Promise.resolve() : Promise.reject(new Error('下班时间必须晚于上班时间')); } })]}><TimePicker format="HH:mm" style={{ width: '100%' }} /></Form.Item></Col>
        </Row>
        <Row gutter={16}>
          <Col xs={24} sm={12}>
            <Typography.Text strong>上班卡时间段</Typography.Text>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <TimePicker value={startTime} format="HH:mm" disabled style={{ width: '50%' }} aria-label="上班卡开始时间" />
              <Form.Item name="inEndTime" dependencies={['startTime', 'endTime']} style={{ width: '50%', marginBottom: 0 }} rules={[{ required: true, message: '请选择上班卡结束时间' }, ({ getFieldValue }) => ({ validator(_, value: Dayjs | undefined) { if (!value) return Promise.resolve(); const text = value.format('HH:mm'); const start = getFieldValue('startTime') as Dayjs | undefined; const end = getFieldValue('endTime') as Dayjs | undefined; return (!start || text >= start.format('HH:mm')) && (!end || text < end.format('HH:mm')) ? Promise.resolve() : Promise.reject(new Error('结束时间须不早于上班时间且早于下班时间')); } })]}>
                <TimePicker format="HH:mm" placeholder="结束时间" style={{ width: '100%' }} aria-label="上班卡结束时间" />
              </Form.Item>
            </div>
          </Col>
          <Col xs={24} sm={12}>
            <Typography.Text strong>下班卡时间段</Typography.Text>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <TimePicker value={endTime} format="HH:mm" disabled style={{ width: '50%' }} aria-label="下班卡开始时间" />
              <Form.Item name="outEndTime" dependencies={['endTime']} style={{ width: '50%', marginBottom: 0 }} rules={[{ required: true, message: '请选择下班卡结束时间' }, ({ getFieldValue }) => ({ validator(_, value: Dayjs | undefined) { const end = getFieldValue('endTime') as Dayjs | undefined; return !value || !end || value.format('HH:mm') >= end.format('HH:mm') ? Promise.resolve() : Promise.reject(new Error('结束时间不能早于下班时间')); } })]}>
                <TimePicker format="HH:mm" placeholder="结束时间" style={{ width: '100%' }} aria-label="下班卡结束时间" />
              </Form.Item>
            </div>
          </Col>
        </Row>
        <Form.Item name="restDates" label="休息日期（可多选）" style={{ marginTop: 24 }}>
          <DatePicker multiple format="YYYY-MM-DD" placeholder="选择休息日期，可不选择" style={{ width: '100%' }} />
        </Form.Item>
        <Typography.Text strong>在地图上点击选择打卡中心</Typography.Text>
        <div style={{ marginTop: 8 }}><MapPicker latitude={latitude ?? form.getFieldValue('latitude')} longitude={longitude ?? form.getFieldValue('longitude')} radius={radius ?? form.getFieldValue('radius')} onSelect={(lat, lng) => form.setFieldsValue({ latitude: lat, longitude: lng })} /></div>
        <Row gutter={16}>
          <Col xs={12}><Form.Item name="latitude" label="纬度（GCJ-02）" rules={[{ required: true, type: 'number', min: -90, max: 90, message: '请在地图选点或输入有效纬度' }]}><InputNumber style={{ width: '100%' }} precision={7} /></Form.Item></Col>
          <Col xs={12}><Form.Item name="longitude" label="经度（GCJ-02）" rules={[{ required: true, type: 'number', min: -180, max: 180, message: '请在地图选点或输入有效经度' }]}><InputNumber style={{ width: '100%' }} precision={7} /></Form.Item></Col>
          <Col xs={24}><Form.Item name="address" label="地点名称或地址" rules={[{ required: true, whitespace: true, max: 255, message: '请填写地点名称或地址' }]}><Input placeholder="例如：公司办公楼" /></Form.Item></Col>
          <Col xs={12}><Form.Item name="radius" label="打卡半径（米）" rules={[{ required: true, type: 'number', min: 1, max: 10000, message: '请输入 1–10000 米' }]}><InputNumber min={1} max={10000} precision={0} style={{ width: '100%' }} /></Form.Item></Col>
        </Row>
        {!editing?.isDefault && (
          <Form.Item label="员工">
            <Space direction="vertical" style={{ width: '100%' }} size={8}>
              <Space>
                <Button onClick={openPicker}>选择员工</Button>
                <Typography.Text type="secondary">已选择 {selectedEmployeeIds.length} 人</Typography.Text>
              </Space>
              {selectedEmployeeIds.length > 0 && (
                <div style={{ maxHeight: 120, overflowY: 'auto' }}>
                  <Space wrap size={4}>
                    {selectedEmployeeIds.map((id) => {
                      const employee = employeeOptions.find((option) => option.id === id);
                      return (
                        <Tag
                          key={id}
                          closable
                          onClose={() => togglePicker(id, false)}
                        >
                          {employee ? `${employee.name}（${employee.employeeNo}）` : id}
                        </Tag>
                      );
                    })}
                  </Space>
                </div>
              )}
            </Space>
          </Form.Item>
        )}
      </Form>
    </Modal>

    <Modal
      title="选择员工"
      open={pickerOpen}
      onCancel={() => setPickerOpen(false)}
      onOk={() => { setSelectedEmployeeIds(pickerSelection); setPickerOpen(false); }}
      okText="确定"
      cancelText="取消"
      width={640}
      zIndex={1200}
      styles={{ body: { maxHeight: '60vh', overflowY: 'auto' } }}
    >
      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        <Row gutter={8} align="middle">
          <Col flex="48px"><Typography.Text>组织</Typography.Text></Col>
          <Col flex="auto">
            <Select
              mode="multiple"
              allowClear
              placeholder="不限组织"
              style={{ width: '100%' }}
              value={pickerOrgs}
              onChange={setPickerOrgs}
              options={organizations.map((org) => ({ value: org.name, label: org.name }))}
              maxTagCount="responsive"
            />
          </Col>
          <Col>
            <Button size="small" onClick={() => setPickerOrgs(allOrgsSelected ? [] : organizations.map((org) => org.name))} disabled={!organizations.length}>
              {allOrgsSelected ? '清空' : '全选'}
            </Button>
          </Col>
        </Row>
        <Row gutter={8} align="middle">
          <Col flex="48px"><Typography.Text>职位</Typography.Text></Col>
          <Col flex="auto">
            <Select
              mode="multiple"
              allowClear
              placeholder="不限职位"
              style={{ width: '100%' }}
              value={pickerPositions}
              onChange={setPickerPositions}
              options={positionOptions.map((position) => ({ value: position, label: position }))}
              maxTagCount="responsive"
            />
          </Col>
          <Col>
            <Button size="small" onClick={() => setPickerPositions(allPositionsSelected ? [] : [...positionOptions])} disabled={!positionOptions.length}>
              {allPositionsSelected ? '清空' : '全选'}
            </Button>
          </Col>
        </Row>
        <Input.Search
          allowClear
          placeholder="搜索姓名、工号"
          value={employeeSearch}
          onChange={(event) => setEmployeeSearch(event.target.value)}
        />
        <Checkbox
          checked={allFilteredChecked}
          indeterminate={someFilteredChecked}
          onChange={(event) => toggleAllFiltered(event.target.checked)}
          disabled={!filteredIds.length}
        >
          全选当前员工（{filteredIds.length} 人）
        </Checkbox>
        <div style={{ maxHeight: 300, overflowY: 'auto' }}>
          {filteredPickerEmployees.length ? filteredPickerEmployees.map((employee) => {
            const otherGroup = employeeGroupMap.get(employee.id);
            const showOtherGroup = otherGroup && (!editing || otherGroup.id !== editing.id);
            return (
              <div key={employee.id} style={{ padding: '6px 0' }}>
                <Checkbox
                  checked={pickerSelection.includes(employee.id)}
                  onChange={(event) => togglePicker(employee.id, event.target.checked)}
                >
                  <Space size={6} wrap>
                    <span>{employee.name}</span>
                    <Typography.Text type="secondary">{employee.employeeNo}</Typography.Text>
                    <Tag>{employee.position}</Tag>
                    {showOtherGroup && <Tag color="orange">已在{otherGroup.name}</Tag>}
                  </Space>
                </Checkbox>
              </div>
            );
          }) : <Typography.Text type="secondary">没有匹配的员工</Typography.Text>}
        </div>
        <Typography.Text type="secondary">已选择 {pickerSelection.length} 人；保存后所选员工将移入本考勤组。</Typography.Text>
      </Space>
    </Modal>

    <Modal
      title="修改考勤组名称"
      open={renameOpen}
      onCancel={() => setRenameOpen(false)}
      onOk={() => void submitRename()}
      confirmLoading={renameSaving}
      okText="保存"
      cancelText="取消"
      width={420}
      zIndex={1200}
      destroyOnClose
    >
      <Input
        value={renameValue}
        maxLength={50}
        placeholder="请输入考勤组名称"
        onChange={(event) => setRenameValue(event.target.value)}
        onPressEnter={() => void submitRename()}
      />
    </Modal>
  </>;
}
