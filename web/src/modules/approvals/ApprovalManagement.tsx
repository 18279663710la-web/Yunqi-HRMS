import { useState } from 'react';
import { Alert, Modal } from 'antd';
import { Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import type { AdminRole } from '../../types';
import type { CustomApprovalType } from './api';
import { CustomApprovalWorkflow } from './CustomApprovalWorkflow';
import { ExpenseRulesSettings } from './ExpenseRulesSettings';

const APPROVAL_TYPES: CustomApprovalType[] = ['leave', 'expense', 'overtime', 'travel', 'purchase'];

export function ApprovalManagementView({ role, type }: { role: AdminRole | undefined; type: CustomApprovalType }) {
  const [rulesOpen, setRulesOpen] = useState(false);
  if (role !== 'super_admin') return <Alert type="warning" message="仅超级管理员可访问审批流程配置" />;
  const rulesButton = type === 'expense' ? <button className="salary-model-entry" type="button" onClick={() => setRulesOpen(true)}>AI 审批规则</button> : undefined;
  return <>
    <CustomApprovalWorkflow key={type} approvalType={type} toolbarExtra={rulesButton} />
    {type === 'expense' && <Modal title="AI 审批规则" open={rulesOpen} onCancel={() => setRulesOpen(false)} footer={null} width={760}>
      <ExpenseRulesSettings />
    </Modal>}
  </>;
}

export function ApprovalManagementPage() {
  const { type } = useParams();
  const { admin } = useAuth();
  if (!APPROVAL_TYPES.includes(type as CustomApprovalType)) return <Navigate to="/approvals/leave" replace />;
  return <ApprovalManagementView role={admin?.role} type={type as CustomApprovalType} />;
}
