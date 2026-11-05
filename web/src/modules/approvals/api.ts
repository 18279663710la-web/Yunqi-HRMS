import { request } from '../../api/client';

export interface ExpenseApproverEmployee {
  id: string;
  name: string;
  employeeNo: string;
  jobCategory: string;
  active: boolean;
}

export type ApprovalApproverType = 'leave' | 'expense' | 'overtime' | 'travel' | 'purchase';

export function fetchApprovalApproverSettings(type: ApprovalApproverType): Promise<{ approver: ExpenseApproverEmployee | null; candidates: ExpenseApproverEmployee[] }> {
  return request(`/admin/approval-approvers/${encodeURIComponent(type)}`);
}

export function saveApprovalApprover(type: ApprovalApproverType, employeeId: string): Promise<ExpenseApproverEmployee> {
  return request(`/admin/approval-approvers/${encodeURIComponent(type)}`, { method: 'PUT', body: { employeeId } });
}

export function fetchExpenseApproverSettings(): Promise<{ approver: ExpenseApproverEmployee | null; candidates: ExpenseApproverEmployee[] }> {
  return request('/admin/expense-approver');
}

export function saveExpenseApprover(employeeId: string): Promise<ExpenseApproverEmployee> {
  return request('/admin/expense-approver', { method: 'PUT', body: { employeeId } });
}

export interface ExpenseRules {
  content: string;
  updatedAt: string | null;
}

export function fetchExpenseRules(): Promise<ExpenseRules> {
  return request('/admin/expense-rules');
}

export function saveExpenseRules(content: string): Promise<ExpenseRules> {
  return request('/admin/expense-rules', { method: 'PUT', body: { content } });
}
