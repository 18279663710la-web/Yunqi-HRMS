import { useEffect, useState } from 'react';
import { App, Button, Form, Spin } from 'antd';
import { ApiError } from '../../../api/client';
import { getAttendancePayrollRules, saveAttendancePayrollRules, type AttendancePayrollRule } from '../../hr/api';
import { AttendanceRulesFields } from './AttendanceRulesFields';
import { SubModuleHeader } from '../../../components/SubModuleHeader';
import { buildAttendanceRules, normalizeAttendanceRules, validateAttendanceRules } from './attendanceRules';

export function PayrollAttendanceRules({ onSaved }: { onSaved: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<{ attendanceRules: AttendancePayrollRule[] }>();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    getAttendancePayrollRules().then(rules => {
      if (!active) return;
      const normalized = normalizeAttendanceRules(rules);
      form.setFieldsValue({ attendanceRules: normalized });
      if (JSON.stringify(normalized) !== JSON.stringify(rules)) message.warning('已按闭环规则整理现有区间，请核对后保存');
    }).catch((error: Error) => {
      if (!active) return;
      const conflict = error instanceof ApiError && error.status === 409;
      setFailed(!conflict);
      if (conflict) form.setFieldsValue({ attendanceRules: normalizeAttendanceRules([]) });
      message.error(error.message);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const save = async (values: { attendanceRules?: AttendancePayrollRule[] }) => {
    const rules = buildAttendanceRules(values.attendanceRules);
    const error = validateAttendanceRules(rules);
    if (error) { message.error(error); return; }
    setSaving(true);
    try {
      const saved = await saveAttendancePayrollRules(rules);
      form.setFieldsValue({ attendanceRules: normalizeAttendanceRules(saved) });
      setFailed(false);
      onSaved();
      message.success('出勤率绩效规则已保存');
    } catch (error) { message.error((error as Error).message); }
    finally { setSaving(false); }
  };
  return <Spin spinning={loading}><Form form={form} layout="vertical" onFinish={save}>
    <SubModuleHeader title="出勤率绩效规则" extra={<Button type="primary" htmlType="submit" loading={saving} disabled={loading || failed}>保存</Button>} />
    <AttendanceRulesFields />
  </Form></Spin>;
}
