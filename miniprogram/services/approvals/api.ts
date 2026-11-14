import type {
ApprovalActionResult,
ApprovalDecorated,
ApprovalDetail,
ApprovalTabCounts,
ApprovalType,
CreateApprovalPayload
} from '../../types/models';
import type { AiStreamEvent } from '../../utils/expense-ai-stream';
import {
get,
post,
streamPost
} from '../../utils/request';

export function getApprovalTypes(): Promise<ApprovalType[]> {
  return get<ApprovalType[]>('/approval-types');
}

export function getLeaveApprover(): Promise<{ id: string; name: string; role: string }> {
  return get<{ id: string; name: string; role: string }>('/approvals/leave-approver');
}

export function getExpenseApprover(): Promise<{ id: string; name: string; role: string }> {
  return get<{ id: string; name: string; role: string }>('/approvals/expense-approver', undefined, { silent: true });
}

export function getApprovalApprover(type: string): Promise<{ id: string; name: string; role: string }> {
  return get<{ id: string; name: string; role: string }>(`/approvals/approvers/${encodeURIComponent(type)}`, undefined, { silent: true });
}

export function previewApprovalAssignees(payload: { type: string; workflowValues?: Record<string, string>; invoices?: Array<{ totalAmount: number }> }): Promise<{ approvers: Array<{ id: string; name: string; role: string }> }> {
  return post<{ approvers: Array<{ id: string; name: string; role: string }> }>('/approvals/assignees', payload, { silent: true });
}

export function getApprovalTabCounts(): Promise<ApprovalTabCounts> {
  return get<ApprovalTabCounts>('/approvals/counts');
}

export function getPendingCount(): Promise<number> {
  return get<number>('/approvals/pending-count');
}

export function getApprovalList(tab: 'pending' | 'mine' | 'done'): Promise<ApprovalDecorated[]> {
  return get<ApprovalDecorated[]>('/approvals', { tab });
}

export function getApprovalDetail(id: string): Promise<ApprovalDetail> {
  return get<ApprovalDetail>(`/approvals/${encodeURIComponent(id)}`);
}

export function createApproval(payload: CreateApprovalPayload): Promise<ApprovalDetail> {
  const invoiceCount = payload.type === 'expense' ? (payload.invoices || []).length : 0;
  return post<ApprovalDetail>('/approvals', payload, { timeout: Math.max(15000, 20000 + invoiceCount * 15000) });
}

export function previewExpenseApproval(payload: CreateApprovalPayload, onEvent: (event: AiStreamEvent) => void): { promise: Promise<void>; abort: () => void } {
  return streamPost('/approvals/expense-precheck/stream', payload, 110000 + (payload.invoices || []).length * 15000, onEvent);
}

export function submitApprovalAction(
  id: string,
  action: 'approve' | 'reject',
  comment: string
): Promise<ApprovalActionResult> {
  return post<ApprovalActionResult>(`/approvals/${encodeURIComponent(id)}/action`, { action, comment });
}

export function retryWorkflowAi(id: string): Promise<{ ok: boolean }> {
  return post<{ ok: boolean }>(`/approvals/${encodeURIComponent(id)}/retry-ai`, {});
}

export function cancelApproval(id: string): Promise<ApprovalActionResult> {
  return post<ApprovalActionResult>(`/approvals/${encodeURIComponent(id)}/cancel`, {});
}
