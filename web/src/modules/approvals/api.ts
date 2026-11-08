import { request } from '../../api/client';

export type CustomApprovalType = 'leave' | 'expense' | 'overtime' | 'travel' | 'purchase';
export type CustomApprovalNodeKind = 'form' | 'approver' | 'branch';
export interface CustomApprovalWorkflow {
  version: number;
  nodes: Array<{ id: string; kind: CustomApprovalNodeKind; position: { x: number; y: number } }>;
  edges: Array<{ id: string; source: string; target: string }>;
}
export const getCustomApprovalWorkflow = (type: CustomApprovalType) => request<CustomApprovalWorkflow>(`/admin/approval-workflows/${type}`);
export const saveCustomApprovalWorkflow = (type: CustomApprovalType, workflow: CustomApprovalWorkflow) => request<CustomApprovalWorkflow>(`/admin/approval-workflows/${type}`, { method: 'PUT', body: workflow });

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
