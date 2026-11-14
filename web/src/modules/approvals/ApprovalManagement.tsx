import { Alert } from 'antd';
import { Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import type { AdminRole } from '../../types';
import type { CustomApprovalType } from './api';
import { CustomApprovalWorkflow } from './CustomApprovalWorkflow';

const APPROVAL_TYPES: CustomApprovalType[] = ['leave', 'expense', 'overtime', 'travel', 'purchase'];

export function ApprovalManagementView({ role, type }: { role: AdminRole | undefined; type: CustomApprovalType }) {
  if (role !== 'super_admin') return <Alert type="warning" message="仅超级管理员可访问审批流程配置" />;
  return <CustomApprovalWorkflow key={type} approvalType={type} />;
}

export function ApprovalManagementPage() {
  const { type } = useParams();
  const { admin } = useAuth();
  if (!APPROVAL_TYPES.includes(type as CustomApprovalType)) return <Navigate to="/approvals/leave" replace />;
  return <ApprovalManagementView role={admin?.role} type={type as CustomApprovalType} />;
}
