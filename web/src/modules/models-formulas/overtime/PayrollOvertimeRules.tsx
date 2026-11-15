import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Form, InputNumber, Select, Space, Spin } from 'antd';
import { getOvertimePayrollConfig, saveOvertimePayrollConfig } from '../../hr/api';
import { OvertimeRulesFields } from './OvertimeRulesFields';
import { SubModuleHeader } from '../../../components/SubModuleHeader';
import { buildOvertimeConfig, defaultOvertimeRules, type OvertimeRuleDraft } from './overtimeConfig';

export function PayrollOvertimeRules({ onSaved }: { onSaved: () => void }) {
  const { message, modal } = App.useApp();
  const [calculation, setCalculation] = useState<'range' | 'unit'>('range');
  const [rules, setRules] = useState<OvertimeRuleDraft[]>([]);
  const [hourlyRate, setHourlyRate] = useState<number | null>(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    getOvertimePayrollConfig().then(value => {
      if (!active) return;
      setCalculation(value.calculation);
      if (value.calculation === 'range') setRules(value.rules);
      else setHourlyRate(value.hourlyRate);
      setFailed(false);
    }).catch((error: Error) => { if (active) { setFailed(true); message.error(error.message); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadAttempt]);
  const changeCalculation = (next: 'range' | 'unit') => {
    if (next === calculation) return;
    modal.confirm({ title: '切换后重新设置规则？', content: '当前编辑的规则将被重置，保存后新规则生效。', okText: '切换', cancelText: '取消', onOk: () => { setRules(defaultOvertimeRules()); setHourlyRate(0); setCalculation(next); } });
  };
  const save = async () => {
    if (loading || failed || saving) return;
    let config;
    try { config = buildOvertimeConfig(calculation, rules, hourlyRate); }
    catch (error) { message.error((error as Error).message); return; }
    setSaving(true);
    try {
      const saved = await saveOvertimePayrollConfig(config);
      setCalculation(saved.calculation);
      if (saved.calculation === 'range') setRules(saved.rules); else setHourlyRate(saved.hourlyRate);
      onSaved(); message.success('加班绩效规则已保存');
    }
    catch (error) { message.error((error as Error).message); }
    finally { setSaving(false); }
  };
  const setUpper = (index: number, value: number | null) => {
    if (value === null) return;
    setRules(current => current.map((rule, i) => i === index ? { ...rule, maxHours: value } : i === index + 1 ? { ...rule, minHours: value } : rule));
  };
  const remove = (index: number) => setRules(current => {
    const next = current.filter((_, i) => i !== index).map(rule => ({ ...rule }));
    if (index === 0) next[0].minHours = 0;
    else next[index - 1].maxHours = current[index].maxHours;
    return next;
  });
  return <Spin spinning={loading}><Form layout="vertical">
    <SubModuleHeader title="加班绩效规则" extra={<Button type="primary" loading={saving} disabled={loading || failed} onClick={() => void save()}>保存</Button>} />
    {failed && <Alert type="error" showIcon message="加班规则加载失败" action={<Button size="small" onClick={() => setLoadAttempt(value => value + 1)}>重试</Button>} style={{ marginBottom: 16 }} />}
    <Space wrap align="start" size={16}>
      <Form.Item label="计算方式"><Select aria-label="计算方式" style={{ width: 180 }} disabled={loading || failed || saving} value={calculation} onChange={changeCalculation} options={[{ value: 'range', label: '按区间' }, { value: 'unit', label: '按单位' }]} /></Form.Item>
      <Form.Item label="统计单位"><Select aria-label="统计单位" style={{ width: 180 }} disabled value="hours" options={[{ value: 'hours', label: '小时' }]} /></Form.Item>
    </Space>
    {calculation === 'unit' ? <Card size="small" style={{ margin: '0 0 24px', borderColor: '#d9d9d9', background: '#fafafa' }}>
      <Form.Item label="每 1 小时金额（元）" required style={{ maxWidth: 360 }}><InputNumber aria-label="每 1 小时金额（元）" min={0} max={9999999999.99} precision={2} value={hourlyRate} onChange={setHourlyRate} style={{ width: '100%' }} /></Form.Item>
    </Card> : <OvertimeRulesFields
      rules={rules}
      onUpperChange={setUpper}
      onRateChange={(index, value) => setRules(current => current.map((item, i) => i === index ? { ...item, hourlyRate: value } : item))}
      onRemove={remove}
      onAdd={() => setRules(current => { const last = current[current.length - 1]; if (!last) return current; const boundary = Math.round((last.minHours + 10) * 100) / 100; if (boundary > 1000000) return current; return [...current.slice(0, -1), { ...last, maxHours: boundary }, { minHours: boundary, maxHours: null, hourlyRate: last.hourlyRate }]; })}
    />}
  </Form></Spin>;
}
