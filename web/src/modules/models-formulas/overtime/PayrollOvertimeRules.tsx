import { useEffect, useState } from 'react';
import { App, Button, Spin } from 'antd';
import { getOvertimePayrollRules, saveOvertimePayrollRules, type OvertimePayrollRule } from '../../hr/api';
import { OvertimeRulesFields } from './OvertimeRulesFields';
import { SubModuleHeader } from '../../../components/SubModuleHeader';

export function PayrollOvertimeRules({ onSaved }: { onSaved: () => void }) {
  const { message } = App.useApp();
  const [rules, setRules] = useState<OvertimePayrollRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    getOvertimePayrollRules().then(value => { if (active) setRules(value); }).catch((error: Error) => { if (active) message.error(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const save = async () => {
    setSaving(true);
    try { setRules(await saveOvertimePayrollRules(rules)); onSaved(); message.success('加班绩效规则已保存'); }
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
  return <Spin spinning={loading}>
    <SubModuleHeader title="加班绩效规则" extra={<Button type="primary" loading={saving} disabled={loading || !rules.length} onClick={() => void save()}>保存</Button>} />
    <OvertimeRulesFields
      rules={rules}
      onUpperChange={setUpper}
      onRateChange={(index, value) => { if (value !== null) setRules(current => current.map((item, i) => i === index ? { ...item, hourlyRate: value } : item)); }}
      onRemove={remove}
      onAdd={() => setRules(current => { const last = current[current.length - 1]; const boundary = Math.round((last.minHours + 10) * 100) / 100; return [...current.slice(0, -1), { ...last, maxHours: boundary }, { minHours: boundary, maxHours: null, hourlyRate: last.hourlyRate }]; })}
    />
  </Spin>;
}
