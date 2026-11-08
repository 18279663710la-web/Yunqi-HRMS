import { request } from '../../api/client';

export type CustomApprovalType = 'leave' | 'expense' | 'overtime' | 'travel' | 'purchase';
export type CustomApprovalNodeKind = 'form' | 'start' | 'verify' | 'approver' | 'branch' | 'end';
export interface CustomApprovalField { key: string; label: string; type: 'text' | 'textarea' | 'number' | 'date' | 'picker'; required: boolean; options?: string[] }
export interface CustomApprovalCondition { field: string; operator: 'eq' | 'gte' | 'lt'; value: string }
export interface CustomApprovalNodeConfig { approverIds?: string[]; outcome?: 'approved' | 'rejected' }
export interface CustomApprovalWorkflow {
  version: number;
  formFields?: CustomApprovalField[];
  nodes: Array<{ id: string; kind: CustomApprovalNodeKind; position: { x: number; y: number }; config?: CustomApprovalNodeConfig }>;
  edges: Array<{ id: string; source: string; target: string; conditions?: CustomApprovalCondition[] }>;
}
export const getCustomApprovalWorkflow = (type: CustomApprovalType) => request<CustomApprovalWorkflow>(`/admin/approval-workflows/${type}`);
export const saveCustomApprovalWorkflow = (type: CustomApprovalType, workflow: CustomApprovalWorkflow) => request<CustomApprovalWorkflow>(`/admin/approval-workflows/${type}`, { method: 'PUT', body: workflow });
export const getCustomWorkflowApproverCandidates = (type: CustomApprovalType) => request<{ candidates: ExpenseApproverEmployee[] }>(`/admin/approval-workflows/${type}/approver-candidates`);

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
