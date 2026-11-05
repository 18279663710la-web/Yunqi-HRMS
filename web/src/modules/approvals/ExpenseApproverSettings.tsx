import { useCallback, useEffect, useState } from 'react';
import { App, Button, Select, Space, Tag, Typography } from 'antd';
import { fetchApprovalApproverSettings, saveApprovalApprover, type ApprovalApproverType, type ExpenseApproverEmployee } from './api';
import { useAuth } from '../../auth/AuthContext';

export function ExpenseApproverSettings({ type = 'expense', label = '发票审批人' }: { type?: ApprovalApproverType; label?: string }) {
  const { admin } = useAuth();
  const { message } = App.useApp();
  const [approver, setApprover] = useState<ExpenseApproverEmployee | null>(null);
  const [candidates, setCandidates] = useState<ExpenseApproverEmployee[]>([]);
  const [selected, setSelected] = useState<string>();
  const [loading, setLoading] = useState(admin?.role === 'super_admin');
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const result = await fetchApprovalApproverSettings(type);
      setApprover(result.approver);
      setCandidates(result.candidates);
      setSelected(result.approver?.active ? result.approver.id : undefined);
    } catch (error) {
      setLoadError((error as Error).message || '加载失败，请重试');
    } finally { setLoading(false); }
  }, [type]);

  useEffect(() => { if (admin?.role === 'super_admin') void load(); }, [admin?.role, load]);

  const save = async () => {
    if (!selected || saving) return;
    setSaving(true);
    try {
      const result = await saveApprovalApprover(type, selected);
      setApprover(result);
      message.success(`${label}已保存`);
    } catch (error) { message.error((error as Error).message || '保存失败'); }
    finally { setSaving(false); }
  };

  if (admin?.role !== 'super_admin') return <Typography.Text type="secondary">仅超级管理员可以管理{label}。</Typography.Text>;
  if (loadError) return <Space><Typography.Text type="danger">{loadError}</Typography.Text><Button onClick={() => void load()}>重试</Button></Space>;

  return (
    <div className="expense-approver-settings">
      <div className="expense-approver-current">
        <div className="expense-approver-label">当前{label}</div>
        {approver ? (
          <Space wrap>
            <span className="expense-approver-name">{approver.name}</span>
            <Typography.Text type="secondary">{approver.employeeNo ? `${approver.jobCategory} · ${approver.employeeNo}` : '董事长小程序账号'}</Typography.Text>
            {!approver.active ? <Tag color="error">账号不可用</Tag> : null}
          </Space>
        ) : <Typography.Text type="secondary">尚未设置</Typography.Text>}
      </div>
      <div className="expense-approver-label">选择审批人</div>
      <div className="expense-approver-controls">
        <Select
          aria-label={`选择${label}`}
          showSearch
          optionFilterProp="label"
          placeholder={type !== 'expense' ? '请选择已启用小程序账号的员工或董事长' : '请选择已启用小程序账号的员工'}
          value={selected}
          onChange={setSelected}
          loading={loading}
          disabled={loading || saving}
          options={candidates.map((employee) => ({ value: employee.id, label: employee.employeeNo ? `${employee.name} · ${employee.jobCategory} · ${employee.employeeNo}` : `${employee.name} · 小程序账号` }))}
        />
        <Button type="primary" onClick={() => void save()} loading={saving} disabled={loading || !selected || (approver?.active === true && selected === approver.id)}>
          保存
        </Button>
      </div>
    </div>
  );
}
