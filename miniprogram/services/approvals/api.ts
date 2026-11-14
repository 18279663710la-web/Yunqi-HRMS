import type {
ApprovalActionResult,
ApprovalDecorated,
ApprovalDetail,
ApprovalTabCounts,
ApprovalType,
CreateApprovalPayload
} from '../../types/models';
import {
get,
post
} from '../../utils/request';

export function getApprovalTypes(): Promise<ApprovalType[]> {
  return get<ApprovalType[]>('/approval-types');
}

export function previewApprovalAssignees(payload: { type: string; workflowValues?: Record<string, string>; invoices?: Array<{ totalAmount: number }> }): Promise<{ approvers: Array<{ id: string; name: string; role: string }>; expenseChecks?: { checkDuplicate: boolean; verifyInvoice: boolean } }> {
  return post<{ approvers: Array<{ id: string; name: string; role: string }>; expenseChecks?: { checkDuplicate: boolean; verifyInvoice: boolean } }>('/approvals/assignees', payload, { silent: true });
}

export function getApprovalTabCounts(): Promise<ApprovalTabCounts> {
  return get<ApprovalTabCounts>('/approvals/counts');
}

export function getPendingCount(): Promise<number> {
  return get<number>('/approvals/pending-count');
}

export function getApprovalList(tab: 'pending' | 'mine' | 'done', options?: number | { limit?: number; page?: number; pageSize?: number }): Promise<ApprovalDecorated[]> {
  const query: Record<string, string | number> = { tab };
  if (typeof options === 'number') query.limit = options;
  else if (options) {
    if (options.limit !== undefined) query.limit = options.limit;
    if (options.page !== undefined) query.page = options.page;
    if (options.pageSize !== undefined) query.pageSize = options.pageSize;
  }
  return get<ApprovalDecorated[]>('/approvals', query);
}

export function getApprovalDetail(id: string): Promise<ApprovalDetail> {
  return get<ApprovalDetail>(`/approvals/${encodeURIComponent(id)}`);
}

export function createApproval(payload: CreateApprovalPayload): Promise<ApprovalDetail> {
  const invoiceCount = payload.type === 'expense' ? (payload.invoices || []).length : 0;
  return post<ApprovalDetail>('/approvals', payload, { timeout: Math.max(15000, 20000 + invoiceCount * 15000) });
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
