import { request } from '../../api/client';

export type CustomApprovalType = 'leave' | 'expense' | 'overtime' | 'travel' | 'purchase';
export type CustomApprovalNodeKind = 'form' | 'start' | 'verify' | 'approver' | 'branch' | 'end' | 'ai';
export interface CustomApprovalField { key: string; label: string; type: 'text' | 'textarea' | 'number' | 'date' | 'picker'; required: boolean; options?: string[] }
export interface CustomApprovalCondition { field: string; operator: 'eq' | 'gte' | 'lt'; value: string }
export interface CustomApprovalNodeConfig { approverIds?: string[]; outcome?: 'approved' | 'rejected'; provider?: 'deepseek' | 'openai-compatible'; model?: string; baseUrl?: string; rules?: string; hasApiKey?: boolean }
export interface CustomApprovalWorkflow {
  version: number;
  formFields?: CustomApprovalField[];
  nodes: Array<{ id: string; kind: CustomApprovalNodeKind; position: { x: number; y: number }; config?: CustomApprovalNodeConfig }>;
  edges: Array<{ id: string; source: string; target: string; conditions?: CustomApprovalCondition[] }>;
}
export const getCustomApprovalWorkflow = (type: CustomApprovalType) => request<CustomApprovalWorkflow>(`/admin/approval-workflows/${type}`);
export const saveCustomApprovalWorkflow = (type: CustomApprovalType, workflow: CustomApprovalWorkflow, credentialUpdates: Array<{ nodeId: string; apiKey: string }> = []) => request<CustomApprovalWorkflow>(`/admin/approval-workflows/${type}`, { method: 'PUT', body: { ...workflow, ...(credentialUpdates.length ? { credentialUpdates } : {}) } });
export const getCustomWorkflowApproverCandidates = (type: CustomApprovalType) => request<{ candidates: ExpenseApproverEmployee[] }>(`/admin/approval-workflows/${type}/approver-candidates`);

export interface WorkflowTestField { key: string; label: string; type: 'text' | 'textarea' | 'number' | 'money' | 'date' | 'time' | 'picker'; required: boolean; options?: string[]; default?: string; maxlength?: number }
export interface WorkflowTestCase { id: string; name: string; values: Record<string, string> }
export interface WorkflowTestCasesDocument { version: number; cases: WorkflowTestCase[] }
export interface WorkflowTestReport { passed: boolean; errors: string[]; cases: Array<{ name: string; passed: boolean; path: string[]; approverIds: string[]; outcome?: 'approved' | 'rejected'; error?: string }>; aiChecks: Array<{ nodeId: string; reachable: boolean; status?: number }> }
export const getWorkflowTestFields = (type: CustomApprovalType) => request<{ fields: WorkflowTestField[] }>(`/admin/approval-workflows/${type}/test-fields`);
export const getWorkflowTestCases = (type: CustomApprovalType) => request<WorkflowTestCasesDocument>(`/admin/approval-workflows/${type}/test-cases`);
export const saveWorkflowTestCases = (type: CustomApprovalType, document: WorkflowTestCasesDocument) => request<WorkflowTestCasesDocument>(`/admin/approval-workflows/${type}/test-cases`, { method: 'PUT', body: document });
export const publishWorkflow = (type: CustomApprovalType, workflowVersion: number, caseVersion: number) => request<{ publicationVersion: number; workflowVersion: number; caseVersion: number }>(`/admin/approval-workflows/${type}/publish`, { method: 'POST', body: { workflowVersion, caseVersion } });
export const testSavedWorkflow = (type: CustomApprovalType) => request<WorkflowTestReport & { workflowVersion: number; caseVersion: number }>(`/admin/approval-workflows/${type}/test`, { method: 'POST', body: {} });

export interface ExpenseApproverEmployee {
  id: string;
  name: string;
  employeeNo: string;
  jobCategory: string;
  active: boolean;
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
