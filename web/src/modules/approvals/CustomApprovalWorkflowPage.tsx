import { Alert } from 'antd';
import { useAuth } from '../../auth/AuthContext';
import type { AdminRole } from '../../types';
import { CustomApprovalWorkflow } from '../models-formulas/payroll-workflow/CustomApprovalWorkflow';

export function CustomApprovalWorkflowView({ role }: { role: AdminRole | undefined }) {
  if (role !== 'super_admin') return <Alert type="warning" message="仅超级管理员可访问自定义审批流程" />;
  return <CustomApprovalWorkflow />;
}

export function CustomApprovalWorkflowPage() {
  const { admin } = useAuth();
  return <CustomApprovalWorkflowView role={admin?.role} />;
}
