import { buildQuery, request } from '../../api/client';

export type CustomApprovalType = 'leave' | 'expense' | 'overtime' | 'travel' | 'purchase';
export type ApprovalTypeKey = CustomApprovalType | (string & {});
export type CustomApprovalNodeKind = 'form' | 'start' | 'verify' | 'approver' | 'branch' | 'end' | 'ai';
export interface CustomApprovalField { key: string; label: string; type: 'text' | 'textarea' | 'number' | 'money' | 'date' | 'time' | 'picker' | 'attachment'; required: boolean; options?: string[]; locked?: boolean }
export interface CustomApprovalCondition { field: string; operator: 'eq' | 'gte' | 'lt'; value: string }
export interface CustomApprovalNodeConfig { approverIds?: string[]; outcome?: 'approved' | 'rejected'; provider?: 'deepseek' | 'openai-compatible'; model?: string; baseUrl?: string; rules?: string; hasApiKey?: boolean; checkDuplicate?: boolean; verifyInvoice?: boolean }
export interface CustomApprovalWorkflow {
  version: number;
  fieldsInitialized?: boolean;
  formFields?: CustomApprovalField[];
  nodes: Array<{ id: string; kind: CustomApprovalNodeKind; position: { x: number; y: number }; config?: CustomApprovalNodeConfig }>;
  edges: Array<{ id: string; source: string; target: string; conditions?: CustomApprovalCondition[] }>;
}
export const getCustomApprovalWorkflow = (type: string) => request<CustomApprovalWorkflow>(`/admin/approval-workflows/${type}`);
export const saveCustomApprovalWorkflow = (type: string, workflow: CustomApprovalWorkflow, credentialUpdates: Array<{ nodeId: string; apiKey: string }> = []) => request<CustomApprovalWorkflow>(`/admin/approval-workflows/${type}`, { method: 'PUT', body: { ...workflow, ...(credentialUpdates.length ? { credentialUpdates } : {}) } });
export const getCustomWorkflowApproverCandidates = (type: string) => request<{ candidates: ExpenseApproverEmployee[] }>(`/admin/approval-workflows/${type}/approver-candidates`);

export interface WorkflowTestField { key: string; label: string; type: 'text' | 'textarea' | 'number' | 'money' | 'date' | 'time' | 'picker'; required: boolean; options?: string[]; default?: string; maxlength?: number }
export interface WorkflowTestCase { id: string; name: string; values: Record<string, string> }
export interface WorkflowTestCasesDocument { version: number; cases: WorkflowTestCase[] }
export interface WorkflowTestReport { passed: boolean; errors: string[]; cases: Array<{ name: string; passed: boolean; path: string[]; approverIds: string[]; outcome?: 'approved' | 'rejected'; error?: string }>; aiChecks: Array<{ nodeId: string; reachable: boolean; status?: number }> }
export const getWorkflowTestFields = (type: string) => request<{ fields: WorkflowTestField[] }>(`/admin/approval-workflows/${type}/test-fields`);
export const getWorkflowTestCases = (type: string) => request<WorkflowTestCasesDocument>(`/admin/approval-workflows/${type}/test-cases`);
export const saveWorkflowTestCases = (type: string, document: WorkflowTestCasesDocument) => request<WorkflowTestCasesDocument>(`/admin/approval-workflows/${type}/test-cases`, { method: 'PUT', body: document });
export const publishWorkflow = (type: string, workflowVersion: number, caseVersion: number) => request<{ publicationVersion: number; workflowVersion: number; caseVersion: number }>(`/admin/approval-workflows/${type}/publish`, { method: 'POST', body: { workflowVersion, caseVersion } });
export const testSavedWorkflow = (type: string) => request<WorkflowTestReport & { workflowVersion: number; caseVersion: number }>(`/admin/approval-workflows/${type}/test`, { method: 'POST', body: {} });
export const getWorkflowPublication = (type: string) => request<{ publicationVersion: number } | null>(`/admin/approval-workflows/${type}/publication`);
export const getApprovalApproverSettings = (type: string) => request<{ approver: ExpenseApproverEmployee | null; candidates: ExpenseApproverEmployee[] }>(`/admin/approval-approvers/${type}`);
export const setApprovalApprover = (type: string, employeeId: string) => request<ExpenseApproverEmployee>(`/admin/approval-approvers/${type}`, { method: 'PUT', body: { employeeId } });
export interface ApprovalTypeOption { key: string; name: string; custom: boolean; published: boolean }
export const getApprovalTypeOptions = () => request<ApprovalTypeOption[]>('/admin/approval-types');
export const createCustomApprovalType = (name: string) => request<ApprovalTypeOption>('/admin/approval-types', { method: 'POST', body: { name } });
export const renameCustomApprovalType = (key: string, name: string) => request<ApprovalTypeOption>(`/admin/approval-types/${key}`, { method: 'PUT', body: { name } });
export const deleteCustomApprovalType = (key: string) => request<{ key: string }>(`/admin/approval-types/${key}`, { method: 'DELETE' });

export type ApprovalSummaryGroup = 'month' | 'organization' | 'position' | 'employee';
export interface ApprovalSummaryField { key: string; label: string; type: 'money' | 'number' }
export interface ApprovalSummaryRow {
  month?: string;
  organization?: string;
  position?: string;
  employee?: string;
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  cancelled: number;
  sums: Record<string, number>;
}
export interface ApprovalSummaryTotals { total: number; pending: number; approved: number; rejected: number; cancelled: number; sums: Record<string, number> }
export interface ApprovalSummaryFilters { organization: string; position: string; employee: string }
export interface ApprovalSummary {
  type: string;
  typeName: string;
  from: string;
  to: string;
  groups: ApprovalSummaryGroup[];
  selectedFields: ApprovalSummaryField[];
  availableFields: ApprovalSummaryField[];
  filters: ApprovalSummaryFilters;
  rows: ApprovalSummaryRow[];
  totals: ApprovalSummaryTotals;
}
export interface ApprovalSummaryOptions {
  organizations: Array<{ id: string; name: string }>;
  positions: string[];
  employees: Array<{ id: string; name: string; employeeNo: string; organizationId: string; position: string }>;
}
export const getApprovalSummaryOptions = () => request<ApprovalSummaryOptions>('/admin/approval-summary-options');
export const getApprovalSummaryFields = (type: string) => request<{ fields: ApprovalSummaryField[] }>(`/admin/approval-summary-fields${buildQuery({ type })}`);
export const getApprovalSummary = (params: {
  type: string;
  from: string;
  to: string;
  organization?: string;
  position?: string;
  employee?: string;
  groups?: string;
  fields?: string;
}) => request<ApprovalSummary>(`/admin/approval-summary${buildQuery(params)}`);

export interface ExpenseApproverEmployee {
  id: string;
  name: string;
  employeeNo: string;
  jobCategory: string;
  active: boolean;
}
