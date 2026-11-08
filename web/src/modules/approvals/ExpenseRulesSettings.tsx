import { useCallback, useEffect, useState } from 'react';
import { App, Button, Input, Space, Typography } from 'antd';

import { fetchExpenseRules, saveExpenseRules } from './api';
import { useAuth } from '../../auth/AuthContext';

export function ExpenseRulesSettings() {
  const { admin } = useAuth();
  const { message } = App.useApp();
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(admin?.role === 'super_admin');
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const result = await fetchExpenseRules();
      setContent(result.content);
      setSavedContent(result.content);
      setUpdatedAt(result.updatedAt);
    } catch (error) {
      setLoadError((error as Error).message || '加载失败，请重试');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (admin?.role === 'super_admin') void load(); }, [admin?.role, load]);

  const save = async () => {
    if (saving || loading || content === savedContent) return;
    setSaving(true);
    try {
      const result = await saveExpenseRules(content);
      setContent(result.content);
      setSavedContent(result.content);
      setUpdatedAt(result.updatedAt);
      message.success('审批规则已保存');
    } catch (error) { message.error((error as Error).message || '保存失败'); }
    finally { setSaving(false); }
  };

  if (admin?.role !== 'super_admin') return <Typography.Text type="secondary">仅超级管理员可以管理审批规则。</Typography.Text>;
  if (loadError) return <Space><Typography.Text type="danger">{loadError}</Typography.Text><Button onClick={() => void load()}>重试</Button></Space>;

  return (
    <div className="expense-rules-settings">
      <label className="expense-rules-label" htmlFor="expense-rules-content">规则内容</label>
      <Input.TextArea
        id="expense-rules-content"
        placeholder="请输入发票审批规则"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        disabled={loading || saving}
        maxLength={10000}
        showCount
        autoSize={{ minRows: 6, maxRows: 18 }}
      />
      <div className="expense-rules-actions">
        <Button type="primary" onClick={() => void save()} loading={saving} disabled={loading || content === savedContent}>保存规则</Button>
        {updatedAt ? <Typography.Text type="secondary">更新于 {updatedAt}</Typography.Text> : null}
      </div>
    </div>
  );
}
