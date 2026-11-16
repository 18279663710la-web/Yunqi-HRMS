import { Alert } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import type { AdminRole } from '../../types';
import { approvalTypeFromSearch } from './approvalTypeDefinitions';
import { CustomApprovalWorkflow } from './CustomApprovalWorkflow';

export function ApprovalManagementView({ role, type, onTypeChange }: { role: AdminRole | undefined; type: string; onTypeChange?: (type: string) => void }) {
  if (role !== 'super_admin') return <Alert type="warning" message="仅超级管理员可访问审批流程配置" />;
  return <CustomApprovalWorkflow approvalType={type} onTypeChange={onTypeChange} />;
}

export function ApprovalManagementPage() {
  const [params, setParams] = useSearchParams();
  const { admin } = useAuth();
  const changeType = (next: string) => {
    const search = new URLSearchParams(params);
    search.set('type', next);
    setParams(search, { replace: true });
  };
  return <ApprovalManagementView role={admin?.role} type={approvalTypeFromSearch(params.get('type'))} onTypeChange={changeType} />;
}
