import { useEffect, useRef, useState } from 'react';
import { Alert, Input } from 'antd';
import { useAuth } from '../../auth/AuthContext';
import type { AdminRole } from '../../types';
import { createCustomApprovalType, deleteCustomApprovalType, renameCustomApprovalType } from './api';
import { CustomApprovalWorkflow } from './CustomApprovalWorkflow';

export function CustomApprovalsView({ role }: { role: AdminRole | undefined }) {
  const draftKey = useRef('');
  const savedName = useRef('');
  const [name, setName] = useState('');
  const [session, setSession] = useState(0);
  const [, setSavedMark] = useState(0);
  useEffect(() => () => {
    const key = draftKey.current;
    draftKey.current = '';
    if (key) void deleteCustomApprovalType(key).catch(() => undefined);
  }, []);
  if (role !== 'super_admin') return <Alert type="warning" message="仅超级管理员可访问审批流程配置" />;
  const resolveType = async () => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('请填写审批名称');
    if (!draftKey.current) {
      const created = await createCustomApprovalType(trimmed);
      draftKey.current = created.key;
      savedName.current = created.name;
      setName(created.name);
      setSavedMark(value => value + 1);
      return created.key;
    }
    if (trimmed !== savedName.current) {
      const renamed = await renameCustomApprovalType(draftKey.current, trimmed);
      savedName.current = renamed.name;
      setName(renamed.name);
    }
    setSavedMark(value => value + 1);
    return draftKey.current;
  };
  const clear = () => {
    draftKey.current = '';
    savedName.current = '';
    setName('');
    setSession(value => value + 1);
  };
  const header = <Input className="module-title-picker" aria-label="审批名称" maxLength={20} value={name} onChange={event => setName(event.target.value)} />;
  return <CustomApprovalWorkflow key={session} approvalType="local-draft" composer title="自定义审批" headerExtra={header} onResolveType={resolveType} extraDirty={name.trim() !== savedName.current} onPublished={clear} />;
}

export function CustomApprovalsPage() {
  const { admin } = useAuth();
  return <CustomApprovalsView role={admin?.role} />;
}
