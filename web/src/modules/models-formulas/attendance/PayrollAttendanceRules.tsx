import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Card, Form, InputNumber, Popover, Select, Spin, Tooltip } from 'antd';
import { getAttendanceRuleConfig, saveAttendanceRuleConfig, type AttendancePayrollRule, type AttendanceRuleConfig } from '../../hr/api';
import { AttendanceRulesFields } from './AttendanceRulesFields';
import { AttendanceModeRulesFields } from './AttendanceModeRulesFields';
import { SubModuleHeader } from '../../../components/SubModuleHeader';
import { SaveOutlined, SettingOutlined } from '@ant-design/icons';
import { normalizeAttendanceRules } from './attendanceRules';
import { buildAttendanceConfig, defaultModeRules, type AttendanceRange, type AttendanceRuleMode } from './attendanceRuleModes';
import { loadAttendanceRuleConfig } from './attendanceRuleLoader';

export function PayrollAttendanceRules({ onSaved }: { onSaved: () => void }) {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<{ attendanceRules: AttendanceRange[]; unitAdjustment: number | null }>();
  const [mode, setMode] = useState<AttendanceRuleMode>('rate_attendance');
  const [calculation, setCalculation] = useState<'range' | 'unit'>('range');
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(false);
  const edited = useRef(false);
  const alive = useRef(false);
  const loadSequence = useRef(0);
  const applyConfig = (config: AttendanceRuleConfig) => {
    setMode(config.mode);
    setCalculation(config.calculation === 'unit' ? 'unit' : 'range');
    if (config.calculation === 'unit') form.setFieldsValue({ unitAdjustment: config.unitAdjustment });
    else {
      const normalized = config.mode === 'rate_attendance' ? normalizeAttendanceRules(config.rules as AttendancePayrollRule[]) : config.rules;
      form.setFieldsValue({ attendanceRules: normalized });
      if (config.mode === 'rate_attendance' && JSON.stringify(normalized) !== JSON.stringify(config.rules)) message.warning('已按闭环规则整理现有区间，请核对后保存');
    }
    edited.current = false;
  };
  const load = async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    const result = await loadAttendanceRuleConfig(getAttendanceRuleConfig);
    if (!alive.current || sequence !== loadSequence.current) return;
    setLoading(false);
    if (result.status === 'error') { setFailure(result.message); return; }
    const replace = () => {
      if (result.status === 'ready') applyConfig(result.config);
      else { form.setFieldsValue({ attendanceRules: normalizeAttendanceRules([]) }); setMode('rate_attendance'); setCalculation('range'); edited.current = false; message.error(result.message); }
      setFailure(null);
    };
    if (edited.current || form.isFieldsTouched()) {
      setResolving(true);
      modal.confirm({
        title: '如何处理未保存的编辑？',
        content: '已读取规则。加载已保存内容会覆盖当前编辑；也可保留当前编辑，再手动保存。',
        okText: '加载已保存内容',
        cancelText: '保留当前编辑',
        onOk: () => { setResolving(false); replace(); },
        onCancel: () => { setResolving(false); if (result.status === 'conflict') message.error(result.message); setFailure(null); },
      });
    } else replace();
  };
  useEffect(() => {
    alive.current = true;
    void load();
    return () => { alive.current = false; loadSequence.current++; };
  }, []);
  const changeMode = (next: AttendanceRuleMode, nextCalculation = calculation) => {
    if (next === mode && nextCalculation === calculation) return;
    modal.confirm({ title: '切换后重新设置规则？', content: '当前编辑的规则将被重置，保存后新规则生效。', okText: '切换', cancelText: '取消', onOk: () => { form.setFieldsValue({ attendanceRules: defaultModeRules(next), unitAdjustment: 0 }); setMode(next); setCalculation(nextCalculation); edited.current = true; } });
  };
  const save = async (values: { attendanceRules?: AttendanceRange[]; unitAdjustment?: number | null }) => {
    if (loading || !!failure || saving || resolving) return;
    let config;
    try { config = buildAttendanceConfig(mode, calculation, values); }
    catch (error) { message.error((error as Error).message); return; }
    setSaving(true);
    try {
      const saved = await saveAttendanceRuleConfig(config);
      if (saved.calculation === 'unit') form.setFieldsValue({ unitAdjustment: saved.unitAdjustment });
      else form.setFieldsValue({ attendanceRules: saved.mode === 'rate_attendance' ? normalizeAttendanceRules(saved.rules as AttendancePayrollRule[]) : saved.rules });
      edited.current = false;
      onSaved();
      message.success('出勤率绩效规则已保存');
    } catch (error) { message.error((error as Error).message); }
    finally { setSaving(false); }
  };
  return <Spin spinning={loading}><Form form={form} layout="vertical" onFinish={save} onValuesChange={() => { edited.current = true; }}>
    <SubModuleHeader title="出勤率绩效规则" />
    <div className="filter-bar" role="toolbar" aria-label="出勤率绩效规则操作">
      <Popover
        arrow={false}
        trigger="click"
        placement="bottomLeft"
        overlayClassName="filter-popover-overlay"
        content={<div className="filter-popover">
          <div className="filter-popover-row">
            <span className="filter-popover-label">计算方式</span>
            <Select aria-label="计算方式" style={{ flex: 1 }} disabled={loading || saving} value={calculation} onChange={(next: 'range' | 'unit') => changeMode(mode, next)} options={[{ value: 'range', label: '按区间' }, { value: 'unit', label: '按单位' }]} />
          </div>
          <div className="filter-popover-row">
            <span className="filter-popover-label">统计单位</span>
            <Select aria-label="统计单位" style={{ flex: 1 }} disabled={loading || saving} value={mode.startsWith('rate_') ? 'rate' : 'days'} onChange={(unit: 'rate' | 'days') => changeMode(`${unit}_${mode.endsWith('absence') ? 'absence' : 'attendance'}`)} options={[{ value: 'rate', label: '按比例' }, { value: 'days', label: '按天数' }]} />
          </div>
          <div className="filter-popover-row">
            <span className="filter-popover-label">统计方式</span>
            <Select aria-label="统计方式" style={{ flex: 1 }} disabled={loading || saving} value={mode.endsWith('absence') ? 'absence' : 'attendance'} onChange={(basis: 'attendance' | 'absence') => changeMode(`${mode.startsWith('rate_') ? 'rate' : 'days'}_${basis}`)} options={[{ value: 'attendance', label: '按出勤' }, { value: 'absence', label: '按缺勤' }]} />
          </div>
        </div>}
      >
        <Tooltip title="统计规则" arrow={false} overlayClassName="app-tooltip">
          <Button className="filter-circle" type="text" aria-label="统计规则" icon={<SettingOutlined />} disabled={loading || saving} />
        </Tooltip>
      </Popover>
      <Tooltip title="保存" arrow={false} overlayClassName="app-tooltip">
        <Button className="filter-circle filter-primary-circle" type="text" aria-label="保存" icon={<SaveOutlined />} loading={saving} disabled={loading || !!failure || resolving} onClick={() => form.submit()} />
      </Tooltip>
    </div>
    {failure && <Alert type="error" showIcon message="出勤绩效规则加载失败" description={typeof failure === 'string' ? failure : '请重试'} action={<Button onClick={() => void load()} disabled={loading}>重试</Button>} style={{ marginBottom: 24 }} />}
    <div hidden={!!failure}>
    {calculation === 'unit' ? <Card size="small" style={{ margin: '0 0 24px', borderColor: 'var(--sf-line-strong)', background: 'var(--sf-surface)' }}>
      <Form.Item name="unitAdjustment" label={`每 ${mode.startsWith('rate_') ? '1 个百分点' : '1 天'}绩效调整（元）`} rules={[{ required: true, message: '请输入每单位绩效调整金额' }]} style={{ maxWidth: 360 }}>
        <InputNumber min={-9999999999.99} max={9999999999.99} precision={2} style={{ width: '100%' }} />
      </Form.Item>
    </Card> : mode === 'rate_attendance' ? <AttendanceRulesFields /> : <AttendanceModeRulesFields mode={mode} />}
    </div>
  </Form></Spin>;
}
