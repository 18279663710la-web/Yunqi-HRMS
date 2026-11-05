import { useEffect, useState } from 'react';
import { App, Button, Card, Form, InputNumber, Select, Space, Spin } from 'antd';
import { ApiError } from '../../../api/client';
import { getAttendanceRuleConfig, saveAttendanceRuleConfig, type AttendancePayrollRule } from '../../hr/api';
import { AttendanceRulesFields } from './AttendanceRulesFields';
import { AttendanceModeRulesFields } from './AttendanceModeRulesFields';
import { SubModuleHeader } from '../../../components/SubModuleHeader';
import { normalizeAttendanceRules } from './attendanceRules';
import { buildAttendanceConfig, defaultModeRules, type AttendanceRange, type AttendanceRuleMode } from './attendanceRuleModes';

export function PayrollAttendanceRules({ onSaved }: { onSaved: () => void }) {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<{ attendanceRules: AttendanceRange[]; unitAdjustment: number | null }>();
  const [mode, setMode] = useState<AttendanceRuleMode>('rate_attendance');
  const [calculation, setCalculation] = useState<'range' | 'unit'>('range');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    getAttendanceRuleConfig().then(config => {
      if (!active) return;
      setMode(config.mode);
      setCalculation(config.calculation === 'unit' ? 'unit' : 'range');
      if (config.calculation === 'unit') {
        form.setFieldsValue({ unitAdjustment: config.unitAdjustment });
      } else {
        const normalized = config.mode === 'rate_attendance' ? normalizeAttendanceRules(config.rules as AttendancePayrollRule[]) : config.rules;
        form.setFieldsValue({ attendanceRules: normalized });
        if (config.mode === 'rate_attendance' && JSON.stringify(normalized) !== JSON.stringify(config.rules)) message.warning('已按闭环规则整理现有区间，请核对后保存');
      }
    }).catch((error: Error) => {
      if (!active) return;
      const conflict = error instanceof ApiError && error.status === 409;
      setFailed(!conflict);
      if (conflict) form.setFieldsValue({ attendanceRules: normalizeAttendanceRules([]) });
      message.error(error.message);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const changeMode = (next: AttendanceRuleMode, nextCalculation = calculation) => {
    if (next === mode && nextCalculation === calculation) return;
    modal.confirm({ title: '切换后重新设置规则？', content: '当前编辑的规则将被重置，保存后新规则生效。', okText: '切换', cancelText: '取消', onOk: () => { form.setFieldsValue({ attendanceRules: defaultModeRules(next), unitAdjustment: 0 }); setMode(next); setCalculation(nextCalculation); } });
  };
  const save = async (values: { attendanceRules?: AttendanceRange[]; unitAdjustment?: number | null }) => {
    let config;
    try { config = buildAttendanceConfig(mode, calculation, values); }
    catch (error) { message.error((error as Error).message); return; }
    setSaving(true);
    try {
      const saved = await saveAttendanceRuleConfig(config);
      if (saved.calculation === 'unit') form.setFieldsValue({ unitAdjustment: saved.unitAdjustment });
      else form.setFieldsValue({ attendanceRules: saved.mode === 'rate_attendance' ? normalizeAttendanceRules(saved.rules as AttendancePayrollRule[]) : saved.rules });
      setFailed(false);
      onSaved();
      message.success('出勤率绩效规则已保存');
    } catch (error) { message.error((error as Error).message); }
    finally { setSaving(false); }
  };
  return <Spin spinning={loading}><Form form={form} layout="vertical" onFinish={save}>
    <SubModuleHeader title="出勤率绩效规则" extra={<Button type="primary" htmlType="submit" loading={saving} disabled={loading || failed}>保存</Button>} />
    <Space wrap align="start" size={16}>
      <Form.Item label="计算方式"><Select aria-label="计算方式" style={{ width: 180 }} disabled={loading || saving} value={calculation} onChange={(next: 'range' | 'unit') => changeMode(mode, next)} options={[{ value: 'range', label: '按区间' }, { value: 'unit', label: '按单位' }]} /></Form.Item>
      <Form.Item label="统计单位"><Select aria-label="统计单位" style={{ width: 180 }} disabled={loading || saving} value={mode.startsWith('rate_') ? 'rate' : 'days'} onChange={(unit: 'rate' | 'days') => changeMode(`${unit}_${mode.endsWith('absence') ? 'absence' : 'attendance'}`)} options={[{ value: 'rate', label: '按比例' }, { value: 'days', label: '按天数' }]} /></Form.Item>
      <Form.Item label="统计方式"><Select aria-label="统计方式" style={{ width: 180 }} disabled={loading || saving} value={mode.endsWith('absence') ? 'absence' : 'attendance'} onChange={(basis: 'attendance' | 'absence') => changeMode(`${mode.startsWith('rate_') ? 'rate' : 'days'}_${basis}`)} options={[{ value: 'attendance', label: '按出勤' }, { value: 'absence', label: '按缺勤' }]} /></Form.Item>
    </Space>
    {calculation === 'unit' ? <Card size="small" style={{ margin: '0 0 24px', borderColor: '#ccd8ea', background: '#f8faff' }}>
      <Form.Item name="unitAdjustment" label={`每 ${mode.startsWith('rate_') ? '1 个百分点' : '1 天'}绩效调整（元）`} rules={[{ required: true, message: '请输入每单位绩效调整金额' }]} style={{ maxWidth: 360 }}>
        <InputNumber min={-9999999999.99} max={9999999999.99} precision={2} style={{ width: '100%' }} />
      </Form.Item>
    </Card> : mode === 'rate_attendance' ? <AttendanceRulesFields /> : <AttendanceModeRulesFields mode={mode} />}
  </Form></Spin>;
}
