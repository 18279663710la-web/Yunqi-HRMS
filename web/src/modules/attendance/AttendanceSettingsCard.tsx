import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Card, Col, DatePicker, Form, Input, InputNumber, Modal, Row, TimePicker, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { fetchAttendanceSettings, saveAttendanceSettings } from './api';
import type { AttendanceSettings } from '../../types';

interface SettingsForm {
  startTime: Dayjs;
  inEndTime: Dayjs;
  endTime: Dayjs;
  outEndTime: Dayjs;
  restDates?: Dayjs[];
  address: string;
  floor?: string;
  latitude?: number;
  longitude?: number;
  radius: number;
}

// The SDK is loaded only when the settings dialog is opened.
type TencentMapSdk = {
  LatLng: new (lat: number, lng: number) => unknown;
  Map: new (element: HTMLElement, options: object) => { on: (event: string, fn: (event: { latLng: { getLat(): number; getLng(): number } }) => void) => void; destroy: () => void };
  MultiMarker: new (options: object) => { setGeometries: (items: object[]) => void; setMap: (map: null) => void };
  MultiCircle: new (options: object) => { setGeometries: (items: object[]) => void; setMap: (map: null) => void };
  CircleStyle: new (options: object) => unknown;
};

function MapPicker({ latitude, longitude, radius, onSelect }: {
  latitude?: number; longitude?: number; radius?: number; onSelect: (lat: number, lng: number) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const layers = useRef<{ sdk: TencentMapSdk; marker: InstanceType<TencentMapSdk['MultiMarker']>; circle: InstanceType<TencentMapSdk['MultiCircle']> }>();
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [error, setError] = useState('');
  const key = (import.meta.env.VITE_TENCENT_MAP_KEY as string | undefined)?.trim();

  useEffect(() => {
    if (!key || !element.current) return;
    let disposed = false;
    let map: InstanceType<TencentMapSdk['Map']> | undefined;
    const global = window as unknown as { TMap?: TencentMapSdk };
    const script = document.createElement('script');
    const init = () => {
      if (disposed || !element.current) return;
      const sdk = global.TMap;
      if (!sdk) { setError('地图加载失败，请检查腾讯位置服务 Key 和域名配置。'); return; }
      try {
        map = new sdk.Map(element.current, { center: new sdk.LatLng(latitude ?? 23.1291, longitude ?? 113.2644), zoom: 16 });
        const marker = new sdk.MultiMarker({ map, geometries: [] });
        const circle = new sdk.MultiCircle({ map, styles: { range: new sdk.CircleStyle({ color: 'rgba(61,110,247,0.18)', borderColor: '#3d6ef7', borderWidth: 2 }) }, geometries: [] });
        layers.current = { sdk, marker, circle };
        if (latitude !== undefined && longitude !== undefined) {
          const center = new sdk.LatLng(latitude, longitude);
          marker.setGeometries([{ id: 'site', position: center }]);
          circle.setGeometries([{ id: 'range', styleId: 'range', center, radius: radius || 100 }]);
        }
        map.on('click', (event) => onSelectRef.current(Number(event.latLng.getLat().toFixed(7)), Number(event.latLng.getLng().toFixed(7))));
      } catch { setError('地图初始化失败，请检查网络和 Key 配置。'); }
    };
    if (global.TMap) init();
    else {
      script.src = `https://map.qq.com/api/gljs?v=1.exp&key=${encodeURIComponent(key)}`;
      script.onload = init;
      script.onerror = () => { if (!disposed) setError('地图加载失败，请检查网络和 Key 配置。'); };
      document.head.appendChild(script);
    }
    return () => { disposed = true; layers.current?.marker.setMap(null); layers.current?.circle.setMap(null); layers.current = undefined; map?.destroy(); };
  }, [key]);

  useEffect(() => {
    const layer = layers.current;
    if (!layer || latitude === undefined || longitude === undefined) return;
    const center = new layer.sdk.LatLng(latitude, longitude);
    layer.marker.setGeometries([{ id: 'site', position: center }]);
    layer.circle.setGeometries([{ id: 'range', styleId: 'range', center, radius: radius || 100 }]);
  }, [latitude, longitude, radius]);

  if (!key) return <Alert type="warning" showIcon message="尚未配置腾讯地图 Key" description="请在 Web 环境中配置 VITE_TENCENT_MAP_KEY，重启后可在地图上选点；也可以手动填写 GCJ-02 坐标。" />;
  return <>{error && <Alert type="error" showIcon message={error} />}<div ref={element} style={{ width: '100%', height: 300, borderRadius: 8, marginBottom: 12 }} /></>;
}

export function AttendanceSettingsCard() {
  const { message } = App.useApp();
  const [form] = Form.useForm<SettingsForm>();
  const [settings, setSettings] = useState<AttendanceSettings | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const latitude = Form.useWatch('latitude', form);
  const longitude = Form.useWatch('longitude', form);
  const radius = Form.useWatch('radius', form);
  const startTime = Form.useWatch('startTime', form);
  const endTime = Form.useWatch('endTime', form);

  useEffect(() => {
    fetchAttendanceSettings().then(setSettings).catch((err: Error) => message.error(err.message)).finally(() => setLoading(false));
  }, []);

  const show = () => {
    form.setFieldsValue({
      startTime: dayjs(`2000-01-01 ${settings?.startTime || '09:00'}:00`),
      inEndTime: settings?.inEndTime ? dayjs(`2000-01-01 ${settings.inEndTime}:00`) : undefined,
      endTime: dayjs(`2000-01-01 ${settings?.endTime || '18:00'}:00`),
      outEndTime: settings?.outEndTime ? dayjs(`2000-01-01 ${settings.outEndTime}:00`) : undefined,
      restDates: (settings?.restDates || []).map((date) => dayjs(date)),
      address: settings?.address || '', floor: settings?.floor || '',
      latitude: settings?.latitude, longitude: settings?.longitude, radius: settings?.radius || 100,
    });
    setOpen(true);
  };

  const save = async (values: SettingsForm) => {
    if (values.latitude === undefined || values.longitude === undefined) return;
    setSaving(true);
    try {
      const updated = await saveAttendanceSettings({ ...values, floor: values.floor?.trim() || '', latitude: values.latitude, longitude: values.longitude,
        startTime: values.startTime.format('HH:mm'), inEndTime: values.inEndTime.format('HH:mm'),
        endTime: values.endTime.format('HH:mm'), outEndTime: values.outEndTime.format('HH:mm'),
        restDates: (values.restDates || []).map((date) => date.format('YYYY-MM-DD')).sort() });
      setSettings(updated);
      setOpen(false);
      message.success('考勤设置已保存');
    } catch (err) { message.error((err as Error).message); }
    finally { setSaving(false); }
  };

  return <>
    <Card className="panel-card" bordered={false} loading={loading} title="打卡设置" extra={<Button onClick={show}>设置打卡规则</Button>}>
      {settings ? <Typography.Text>办公时间 {settings.startTime}–{settings.endTime}　·　{settings.address}{settings.floor ? ` · ${settings.floor}` : ''}　·　半径 {settings.radius} 米{!settings.inEndTime || !settings.outEndTime ? '　·　请补充打卡时段结束时间' : ''}</Typography.Text>
        : <Typography.Text type="secondary">尚未设置打卡地点，员工暂时无法打卡。</Typography.Text>}
    </Card>
    <Modal title="设置打卡规则" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={saving} okText="保存" cancelText="取消" width={760} destroyOnClose styles={{ body: { maxHeight: '68vh', overflowY: 'auto' } }}>
      <Form form={form} layout="vertical" onFinish={save}>
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
        <Alert type="info" showIcon message="时间段包含开始和结束分钟，不支持跨午夜；楼层仅作地点说明。" style={{ marginBottom: 16 }} />
        <Typography.Text strong>在地图上点击选择打卡中心</Typography.Text>
        <div style={{ marginTop: 8 }}><MapPicker latitude={latitude} longitude={longitude} radius={radius} onSelect={(lat, lng) => form.setFieldsValue({ latitude: lat, longitude: lng })} /></div>
        <Row gutter={16}>
          <Col xs={12}><Form.Item name="latitude" label="纬度（GCJ-02）" rules={[{ required: true, type: 'number', min: -90, max: 90, message: '请在地图选点或输入有效纬度' }]}><InputNumber style={{ width: '100%' }} precision={7} /></Form.Item></Col>
          <Col xs={12}><Form.Item name="longitude" label="经度（GCJ-02）" rules={[{ required: true, type: 'number', min: -180, max: 180, message: '请在地图选点或输入有效经度' }]}><InputNumber style={{ width: '100%' }} precision={7} /></Form.Item></Col>
          <Col xs={16}><Form.Item name="address" label="地点名称或地址" rules={[{ required: true, whitespace: true, max: 255, message: '请填写地点名称或地址' }]}><Input placeholder="例如：公司办公楼" /></Form.Item></Col>
          <Col xs={8}><Form.Item name="floor" label="楼层说明"><Input maxLength={50} placeholder="例如：3楼" /></Form.Item></Col>
          <Col xs={12}><Form.Item name="radius" label="打卡半径（米）" rules={[{ required: true, type: 'number', min: 1, max: 10000, message: '请输入 1–10000 米' }]}><InputNumber min={1} max={10000} precision={0} style={{ width: '100%' }} /></Form.Item></Col>
        </Row>
      </Form>
    </Modal>
  </>;
}
