import crypto from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';

import { queryOne, queryRows, transaction } from '../../shared/db/pool';
import type {
  Approval,
  ApprovalDecorated,
  ApprovalDetail,
  ApprovalFormItem,
  ApprovalStatus,
  ApprovalTabCounts,
  CurrentUser,
  Invoice,
  TimelineNode,
  TimelineState,
} from '../../shared/types/models';
import { formatTime, toMinuteText } from '../../shared/utils/datetime';
import { badRequest, conflict, notFound } from '../../shared/utils/errors';
import { invoiceKey, round2 } from '../../shared/utils/invoice';
import { signExpenseFile } from './expenseFileAccess';
import { calculateLeaveDays } from '../../shared/utils/leaveDuration';
import { checkDuplicate, verifyInvoice } from '../invoices/invoiceService';
import { ensureInvoicesVerified } from '../invoices/tencentInvoiceVerifier';
import { getApprovalApprover, parseApproverType, getActiveApproverCandidates } from './expenseApproverService';
import { readPublishedWorkflow } from './customWorkflowPublication';
import { expenseVerificationSelection, planWorkflowExecution } from './customWorkflowExecutionPlan';
import { overtimeConflictMessage, overtimeInterval } from './overtimeOverlap';
import { ownWorkflowValue, validateWorkflowTestCase, type WorkflowTestField } from './customWorkflowTestFields';
import { employeeApprovalFields } from './approvalFormFields';
import { advanceWorkflowTimeline } from './workflowAdvance';
import { getWorkflowAiState } from './workflowAiWorker';
import { enqueueExpenseAi, getExpenseAiAdvice } from './expenseAiService';
import type { RowDataPacket } from 'mysql2';

function storedApprovalForm(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return []; }
}

interface ApprovalRow {
  id: string;
  type: string;
  type_name: string;
  title: string;
  status: ApprovalStatus;
  urgent: number;
  applicant_id: string;
  applicant_name: string;
  applicant_dept: string;
  applicant_position: string;
  node: string | null;
  summary: string | null;
  form_json: string | Array<ApprovalFormItem>;
  created_at: string;
  updated_at: string | null;
  is_custom_workflow?: number;
}

interface TimelineRow {
  id: number;
  approval_id: string;
  step_no: number;
  name: string;
  role: string;
  action: string;
  comment: string | null;
  time_text: string | null;
  state: TimelineState;
  approver_id: string | null;
}

interface InvoiceRow {
  id: string;
  approval_id: string | null;
  source: string;
  file_id: string | null;
  invoice_type: string;
  invoice_code: string;
  invoice_number: string;
  invoice_date: string;
  seller_name: string;
  seller_tax_no: string;
  buyer_name: string;
  category: string;
  item_name: string;
  amount: number;
  tax_rate: string;
  tax_amount: number;
  total_amount: number;
  check_code: string;
  remark: string;
  is_mock: number;
  is_qr: number;
  qr_from: string;
  qr_crc_verified: number;
}

export interface CreateApprovalPayload {
  type: string;
  title?: string;
  summary?: string;
  form?: ApprovalFormItem[];
  invoices?: Array<Partial<Invoice> & Record<string, unknown>>;
  attachments?: Array<{ name: string; fileID: string }>;
  urgent?: boolean;
  workflowPublicationVersion?: number;
  workflowValues?: Record<string, string>;
}

const FINAL_STATUS: Record<string, { text: string; cls: string }> = {
  approved: { text: '已通过', cls: 'tag-green' },
  rejected: { text: '已驳回', cls: 'tag-red' },
  cancelled: { text: '已撤销', cls: 'tag-gray' },
};

function parseJson<T>(value: string | T | null | undefined, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value;
}

function mapInvoice(r: InvoiceRow): Invoice {
  return {
    id: r.id,
    source: r.source || 'image',
    fileID: r.file_id || '',
    invoiceType: r.invoice_type || '',
    invoiceCode: r.invoice_code || '',
    invoiceNumber: r.invoice_number || '',
    invoiceDate: r.invoice_date || '',
    sellerName: r.seller_name || '',
    sellerTaxNo: r.seller_tax_no || '',
    buyerName: r.buyer_name || '',
    category: r.category || '',
    itemName: r.item_name || '',
    amount: round2(r.amount),
    taxRate: r.tax_rate || '',
    taxAmount: round2(r.tax_amount),
    totalAmount: round2(r.total_amount),
    checkCode: r.check_code || '',
    remark: r.remark || '',
    isMock: !!r.is_mock,
    isQR: !!r.is_qr,
    qrFrom: r.qr_from || '',
    qrCrcVerified: !!r.qr_crc_verified,
  };
}

function mapTimeline(row: TimelineRow): TimelineNode {
  return {
    name: row.name,
    role: row.role,
    action: row.action,
    comment: row.comment || undefined,
    time: row.time_text || '',
    state: row.state,
    approverId: row.approver_id || undefined,
  };
}

export function toApproval(
  row: ApprovalRow,
  timeline: TimelineNode[],
  invoices: Invoice[]
): Approval {
  return {
    id: row.id,
    type: row.type,
    typeName: row.type_name,
    title: row.title,
    status: row.status,
    urgent: !!row.urgent,
    applicantId: row.applicant_id,
    applicantName: row.applicant_name,
    applicantDept: row.applicant_dept,
    applicantPosition: row.applicant_position,
    createdAt: toMinuteText(row.created_at),
    updatedAt: row.updated_at ? toMinuteText(row.updated_at) : undefined,
    node: row.node || '',
    summary: row.summary || '',
    form: parseJson<ApprovalFormItem[]>(row.form_json, []),
    invoices,
    timeline,
    ...(row.is_custom_workflow ? { workflowInstance: true } : {}),
  };
}

const APPLICANT_POSITION_SQL = `CASE WHEN a.applicant_position IN ('研发员', '业务员', '员工') OR EXISTS
       (SELECT 1 FROM job_titles t WHERE t.name = a.applicant_position)
       THEN a.applicant_position ELSE COALESCE(e.position, a.applicant_position) END`;
const APPROVAL_FROM = 'FROM approvals a LEFT JOIN employees e ON e.id = a.applicant_id';
const APPROVAL_SELECT = `SELECT a.*, EXISTS (SELECT 1 FROM approval_workflow_instances i WHERE i.approval_id = a.id) AS is_custom_workflow, ${APPLICANT_POSITION_SQL} AS applicant_position
     ${APPROVAL_FROM}`;
const APPROVAL_LIST_SELECT = `SELECT a.id, a.type, a.type_name, a.title, a.status, a.urgent, a.applicant_id, a.applicant_name, a.applicant_dept, a.node, a.summary, a.created_at, a.updated_at, ${APPLICANT_POSITION_SQL} AS applicant_position
     ${APPROVAL_FROM}`;

function approvalVisibility(tab: 'pending' | 'mine' | 'done', user: CurrentUser): { sql: string; params: string[] } {
  if (tab === 'pending') return { sql: `a.status = 'pending' AND EXISTS (SELECT 1 FROM approval_timeline t WHERE t.approval_id = a.id AND t.state = 'current' AND t.approver_id = ?)`, params: [user.id] };
  if (tab === 'mine') return { sql: 'a.applicant_id = ?', params: [user.id] };
  return { sql: `a.status IN ('approved', 'rejected') AND (a.applicant_id = ? OR EXISTS (SELECT 1 FROM approval_timeline t WHERE t.approval_id = a.id AND t.approver_id = ?))`, params: [user.id, user.id] };
}

async function hydrateApprovals(rows: ApprovalRow[]): Promise<Approval[]> {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(',');
  const [timelineRows, invoiceRows] = await Promise.all([
    queryRows<TimelineRow>(`SELECT * FROM approval_timeline WHERE approval_id IN (${placeholders}) ORDER BY approval_id, step_no`, ids),
    queryRows<InvoiceRow>(`SELECT * FROM invoices WHERE approval_id IN (${placeholders}) ORDER BY created_at, id`, ids),
  ]);
  const timelineMap = new Map<string, TimelineNode[]>();
  timelineRows.forEach((row) => {
    const list = timelineMap.get(row.approval_id) || [];
    list.push(mapTimeline(row));
    timelineMap.set(row.approval_id, list);
  });
  const invoiceMap = new Map<string, Invoice[]>();
  invoiceRows.forEach((row) => {
    if (!row.approval_id) return;
    const list = invoiceMap.get(row.approval_id) || [];
    list.push(mapInvoice(row));
    invoiceMap.set(row.approval_id, list);
  });
  return rows.map((row) => toApproval(row, timelineMap.get(row.id) || [], invoiceMap.get(row.id) || []));
}

function canReadApproval(user: CurrentUser, approval: Approval): boolean {
  const onTimeline = approval.timeline.some((node) => node.approverId === user.id);
  return approval.applicantId === user.id || onTimeline;
}

export function expenseBranchAmount(invoices: Array<{ totalAmount: number }>): string {
  return round2(invoices.reduce((sum, invoice) => sum + Number(invoice.totalAmount || 0), 0)).toFixed(2);
}

function getCurrentNode(a: Approval): TimelineNode | null {
  return a.timeline.find((n) => n.state === 'current') || null;
}

function isPendingForMe(a: Approval, user: CurrentUser): boolean {
  if (a.status !== 'pending') return false;
  const node = getCurrentNode(a);
  return !!(node && node.approverId === user.id);
}

export function decorateApproval(a: Approval, user: CurrentUser): ApprovalDecorated {
  let statusText = '流转中';
  let statusClass = 'tag-gray';

  if (a.status === 'pending') {
    if (isPendingForMe(a, user)) {
      statusText = '待我审批';
      statusClass = 'tag-orange';
    } else if (a.applicantId === user.id) {
      statusText = '审批中';
      statusClass = 'tag-blue';
    }
  } else {
    const s = FINAL_STATUS[a.status] || { text: '未知', cls: 'tag-gray' };
    statusText = s.text;
    statusClass = s.cls;
  }

  return {
    ...a,
    invoices: a.invoices || [],
    statusText,
    statusClass,
    initial: a.applicantName.slice(0, 1),
    timeText: a.createdAt.slice(5),
    canApprove: isPendingForMe(a, user),
    isMine: a.applicantId === user.id,
  };
}

async function countVisible(tab: 'pending' | 'mine' | 'done', user: CurrentUser): Promise<number> {
  const filter = approvalVisibility(tab, user);
  const row = await queryOne<{ total: number }>(`SELECT COUNT(*) AS total FROM approvals a WHERE ${filter.sql}`, filter.params);
  return Number(row?.total || 0);
}

function listWindow(limit?: number | { limit?: number; page?: number; pageSize?: number }): string {
  if (limit === undefined) return '';
  if (typeof limit === 'number') {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw badRequest('列表条数无效');
    return ` LIMIT ${limit}`;
  }
  if (limit.limit !== undefined && limit.page !== undefined) throw badRequest('列表条数无效');
  if (limit.page === undefined && limit.pageSize === undefined) {
    if (limit.limit !== undefined && (!Number.isInteger(limit.limit) || limit.limit < 1 || limit.limit > 100)) throw badRequest('列表条数无效');
    return limit.limit ? ` LIMIT ${limit.limit}` : '';
  }
  const page = limit.page;
  if (page === undefined || !Number.isInteger(page) || page < 1) throw badRequest('列表页码无效');
  const size = limit.pageSize ?? 20;
  if (!Number.isInteger(size) || size < 1 || size > 100) throw badRequest('列表条数无效');
  return ` LIMIT ${size} OFFSET ${(page - 1) * size}`;
}

async function hydrateApprovalList(rows: ApprovalRow[]): Promise<Approval[]> {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const currentRows = await queryRows<{ approval_id: string; approver_id: string | null }>(
    `SELECT approval_id, approver_id FROM approval_timeline WHERE state = 'current' AND approval_id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
  const currentApprover = new Map(currentRows.map((row) => [row.approval_id, row.approver_id || undefined]));
  return rows.map((row) => toApproval(row, currentApprover.has(row.id) ? [{ name: '', role: '', action: '', time: '', state: 'current', approverId: currentApprover.get(row.id) }] : [], []));
}

export async function getApprovalList(
  tab: 'pending' | 'mine' | 'done',
  user: CurrentUser,
  limit?: number | { limit?: number; page?: number; pageSize?: number },
): Promise<Array<Omit<ApprovalDecorated, 'form' | 'invoices' | 'timeline'>>> {
  const windowSql = listWindow(limit);
  const filter = approvalVisibility(tab, user);
  const rows = await queryRows<ApprovalRow>(`${APPROVAL_LIST_SELECT} WHERE ${filter.sql} ORDER BY a.urgent DESC, a.created_at DESC, a.id DESC${windowSql}`, filter.params);
  const list = await hydrateApprovalList(rows);
  return list.map((item) => {
    const { form: _form, invoices: _invoices, timeline: _timeline, ...rest } = decorateApproval(item, user);
    return rest;
  });
}

export async function getApprovalTabCounts(user: CurrentUser): Promise<ApprovalTabCounts> {
  const [pending, mine, done] = await Promise.all([
    countVisible('pending', user),
    countVisible('mine', user),
    countVisible('done', user),
  ]);
  return { pending, mine, done };
}

export async function getPendingCount(user: CurrentUser): Promise<number> {
  return countVisible('pending', user);
}

export async function getApprovalDetail(id: string, user: CurrentUser, options?: { includeFlow?: boolean }): Promise<ApprovalDetail | null> {
  const rows = await queryRows<ApprovalRow>(`${APPROVAL_SELECT} WHERE a.id = ?`, [id]);
  const [approval] = await hydrateApprovals(rows);
  if (!approval || !canReadApproval(user, approval)) return null;
  const decorated = decorateApproval(approval, user);
  const attachments = approval.type === 'expense' ? await queryRows<{ name: string; fileID: string }>('SELECT name, file_id AS fileID FROM expense_attachments WHERE approval_id = ? ORDER BY id', [approval.id]) : [];
  const isApprover = approval.timeline.some((node) => node.approverId === user.id);
  const workflowAi = approval.workflowInstance ? await getWorkflowAiState(approval.id, approval.applicantId === user.id || isApprover, isApprover) : null;
  const aiAdvice = workflowAi?.aiAdvice ?? (approval.type === 'expense' && isApprover ? await getExpenseAiAdvice(approval.id, user.id) : null);
  // 申请人且非流程参与人时不展示流转过程：时间线与当前节点裁剪，仅保留最终状态与驳回意见。
  // 创建单据的提交返回不对外展示，仍保留时间线供引擎断言与提交确认使用。
  const flowVisible = isApprover || options?.includeFlow === true;
  const timeline = flowVisible ? approval.timeline : [];
  const node = flowVisible ? approval.node : '';
  const finalComment = !flowVisible && approval.status === 'rejected'
    ? approval.timeline.find((timelineNode) => timelineNode.state === 'reject')?.comment
    : undefined;
  return {
    ...decorated,
    node,
    timeline,
    invoices: decorated.invoices.map((invoice) => invoice.fileID ? { ...invoice, fileID: signExpenseFile(invoice.fileID) } : invoice),
    attachments: attachments.map((item) => ({ ...item, fileID: item.fileID ? signExpenseFile(item.fileID) : item.fileID })),
    aiAdvice,
    ...(workflowAi ? { aiRetryAvailable: workflowAi.aiRetryAvailable, workflowAiStatus: workflowAi.workflowAiStatus } : {}),
    ...(finalComment ? { finalComment } : {}),
    flowVisible,
    canApprove: approval.status === 'pending' && isPendingForMe(approval, user),
    canCancel: approval.status === 'pending' && approval.applicantId === user.id,
  };
}

function duplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'ER_DUP_ENTRY';
}

async function insertApprovalRow(conn: PoolConnection, now: Date, values: unknown[]): Promise<string> {
  const prefix = `FA${formatTime(now, 'YYYYMMDD')}`;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = `${prefix}${crypto.randomInt(0, 100_000_000).toString().padStart(8, '0')}`;
    try {
      await conn.query(
        `INSERT INTO approvals
          (id, type, type_name, title, status, urgent, applicant_id, applicant_name, applicant_dept,
           applicant_position, node, summary, form_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [id, ...values],
      );
      return id;
    } catch (error) {
      if (!duplicateKey(error) || attempt === 7) throw error;
    }
  }
  throw conflict('审批单号生成失败，请重试');
}

function normalizeInvoiceInput(
  raw: Partial<Invoice> & Record<string, unknown>,
  index: number
): Invoice {
  const amount = round2(raw.amount);
  const taxAmount = round2(raw.taxAmount);
  const total = round2(raw.totalAmount ?? amount + taxAmount);
  return {
    id: String(raw.id || `inv_${Date.now()}_${index}`),
    source: String(raw.source || 'image'),
    fileID: String(raw.fileID || ''),
    invoiceType: String(raw.invoiceType || ''),
    invoiceCode: String(raw.invoiceCode || ''),
    invoiceNumber: String(raw.invoiceNumber || ''),
    invoiceDate: String(raw.invoiceDate || ''),
    sellerName: String(raw.sellerName || ''),
    sellerTaxNo: String(raw.sellerTaxNo || ''),
    buyerName: String(raw.buyerName || ''),
    category: String(raw.category || ''),
    itemName: String(raw.itemName || ''),
    amount,
    taxRate: String(raw.taxRate || ''),
    taxAmount,
    totalAmount: total,
    checkCode: String(raw.checkCode || ''),
    remark: String(raw.remark || ''),
    isMock: Boolean(raw.isMock || raw.__mock),
    isQR: Boolean(raw.isQR || raw.__fromQR),
    qrFrom: String(raw.qrFrom || ''),
    qrCrcVerified: Boolean(raw.qrCrcVerified),
  };
}

async function insertInvoice(
  conn: PoolConnection,
  inv: Invoice,
  approvalId: string
): Promise<void> {
  await conn.query(
    `INSERT INTO invoices
      (id, approval_id, invoice_key, source, file_id, invoice_type, invoice_code, invoice_number, invoice_date,
       seller_name, seller_tax_no, buyer_name, category, item_name, amount, tax_rate, tax_amount, total_amount,
       check_code, remark, is_mock, is_qr, qr_from, qr_crc_verified, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      inv.id,
      approvalId,
      invoiceKey(inv) || null,
      inv.source || 'image',
      inv.fileID || '',
      inv.invoiceType || '',
      inv.invoiceCode || '',
      inv.invoiceNumber || '',
      inv.invoiceDate || '',
      inv.sellerName || '',
      inv.sellerTaxNo || '',
      inv.buyerName || '',
      inv.category || '',
      inv.itemName || '',
      inv.amount,
      inv.taxRate || '',
      inv.taxAmount,
      inv.totalAmount,
      inv.checkCode || '',
      inv.remark || '',
      inv.isMock ? 1 : 0,
      inv.isQR ? 1 : 0,
      inv.qrFrom || '',
      inv.qrCrcVerified ? 1 : 0,
    ]
  );
}

async function ownedUploadIds(ownerId: string, fileIds: string[], query: (sql: string, params: unknown[]) => Promise<Array<{ file_id: string }>>): Promise<Set<string>> {
  const ids = [...new Set(fileIds.filter((id) => id))];
  if (!ids.length) return new Set();
  const rows = await query(`SELECT file_id FROM expense_uploads WHERE owner_id = ? AND file_id IN (${ids.map(() => '?').join(',')})`, [ownerId, ...ids]);
  return new Set(rows.map((row) => row.file_id));
}

export function approvalAssigneesFromSteps(
  steps: Array<{ kind: string; approverId?: string }>,
  candidates: Array<{ id: string; name: string; jobCategory?: string }>,
): Array<{ id: string; name: string; role: string }> | null {
  const info = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const approvers: Array<{ id: string; name: string; role: string }> = [];
  for (const step of steps) {
    if (step.kind !== 'approver' || !step.approverId) continue;
    const candidate = info.get(step.approverId);
    if (!candidate?.name) return null;
    approvers.push({ id: step.approverId, name: candidate.name, role: candidate.jobCategory === '董事长' ? '董事长' : '审批人' });
  }
  return approvers;
}

/** 按当前表单预览将要出现的审批人。未发布类型返回原指定审批人，不创建单据。 */
export async function previewApprovalAssignees(payload: {
  type?: string;
  workflowValues?: Record<string, string>;
  invoices?: Array<{ totalAmount?: number }>;
}): Promise<{ approvers: Array<{ id: string; name: string; role: string }>; expenseChecks: { checkDuplicate: boolean; verifyInvoice: boolean } }> {
  const approvalType = parseApproverType(String(payload.type || '').trim());
  const publication = await readPublishedWorkflow(approvalType);
  if (!publication) return { approvers: [await getApprovalApprover(approvalType)], expenseChecks: { checkDuplicate: true, verifyInvoice: true } };
  const values = { ...(payload.workflowValues || {}) };
  if (approvalType === 'leave') {
    const days = calculateLeaveDays(values.startDate || '', values.startClock || '', values.endDate || '', values.endClock || '');
    if (days === null) return { approvers: [], expenseChecks: { checkDuplicate: true, verifyInvoice: true } };
    values.days = String(days);
  }
  const invoices = Array.isArray(payload.invoices) ? payload.invoices : [];
  // 未添加发票时按 0 元预览；流程未按金额分支时同样能给出确定的审批人。分支未匹配等配置问题直接抛出，让申请人看到真实原因。
  const branchValues = { ...values };
  if (approvalType === 'expense') branchValues.amount = expenseBranchAmount(invoices.map((invoice) => ({ totalAmount: Number(invoice.totalAmount) || 0 })));
  const plan = planWorkflowExecution(approvalType, publication.workflow, branchValues);
  const candidates = await getActiveApproverCandidates(plan.steps.flatMap((step) => step.kind === 'approver' && step.approverId ? [step.approverId] : []));
  const approvers = approvalAssigneesFromSteps(plan.steps, candidates);
  if (!approvers) throw badRequest('审批人账号不可用，请联系管理员');
  return { approvers, expenseChecks: approvalType === 'expense' ? expenseVerificationSelection(plan.steps) : { checkDuplicate: true, verifyInvoice: true } };
}

export async function createApproval(
  payload: CreateApprovalPayload,
  user: CurrentUser
): Promise<ApprovalDetail> {
  const typeKey = String(payload.type || '').trim();
  const typeRow = await queryOne<{ key: string; name: string }>(
    'SELECT `key`, `name` FROM approval_types WHERE `key` = ?',
    [typeKey]
  );
  if (!typeRow) throw badRequest('审批类型不存在');

  const approvalType = parseApproverType(typeKey);
  const publication = await readPublishedWorkflow(approvalType);
  if (publication && payload.workflowPublicationVersion !== publication.publicationVersion) throw conflict('审批流程已更新，请重新打开申请页面');
  if (publication && !payload.workflowValues) throw badRequest('审批表单已更新，请重新打开申请页面');
  const values = publication ? { ...payload.workflowValues } : undefined;
  if (values && typeKey === 'leave') {
    const days = calculateLeaveDays(values.startDate || '', values.startClock || '', values.endDate || '', values.endClock || '');
    if (days === null) throw badRequest('请假结束时间须晚于开始时间');
    values.days = String(days);
  }
  const entryFields = publication ? employeeApprovalFields(approvalType, publication.fixedFields, publication.workflow.formFields ?? []) : [];
  const valueFields = entryFields.filter((field): field is WorkflowTestField => field.type !== 'attachment');
  if (publication && values) {
    const testValues = { ...values, __invoice: payload.invoices?.length ? '已提供' : '未提供' };
    const error = validateWorkflowTestCase(approvalType, valueFields, testValues);
    if (error) throw badRequest(error);
  }

  const now = new Date();
  const createdAt = formatTime(now, 'YYYY-MM-DD HH:mm');
  let title = String(payload.title || '').trim() || `${typeRow.name}申请`;
  let summary = String(payload.summary || '').trim();
  const form = publication && values
    ? valueFields.map(field => { const value = ownWorkflowValue(values, field.key); return { label: field.label, value: value ? (field.type === 'money' ? `¥${value}` : value) : '—' }; })
    : Array.isArray(payload.form)
      ? payload.form.filter((f) => f && typeof f.label === 'string').map((f) => ({ label: String(f.label), value: String(f.value ?? '') }))
      : [];

  const formWithInvoices = form.slice();
  if (typeKey === 'overtime') {
    for (let i = formWithInvoices.length - 1; i >= 0; i -= 1) {
      if (formWithInvoices[i].label === '补偿方式') formWithInvoices.splice(i, 1);
    }
    formWithInvoices.push({ label: '补偿方式', value: '加班费' });
    const date = formWithInvoices.find((item) => item.label === '加班日期')?.value || '';
    summary = `${date} 加班，补偿方式：加班费`;
  }
  const overtimeRange = typeKey === 'overtime' ? overtimeInterval(values ?? formWithInvoices) : null;
  if (typeKey === 'overtime' && !overtimeRange) throw badRequest('结束时间需晚于开始时间');
  if (typeKey === 'leave') {
    const labeled = (label: string): string => {
      const matches = form.filter((item) => item.label === label);
      if (matches.length !== 1) throw badRequest(`请填写有效的${label}`);
      return matches[0].value.trim();
    };
    const startDate = (values?.startDate || labeled('开始日期')).trim();
    const startTime = (values?.startClock || labeled('开始时间')).trim();
    const endDate = (values?.endDate || labeled('结束日期')).trim();
    const endTime = (values?.endClock || labeled('结束时间')).trim();
    const days = calculateLeaveDays(startDate, startTime, endDate, endTime);
    if (days === null) throw badRequest('请假结束时间须晚于开始时间');
    const durationLabel = valueFields.find((field) => field.key === 'days')?.label || '请假时长（天）';
    const durationFields = formWithInvoices.filter((item) => item.label === durationLabel);
    if (durationFields.length > 1) throw badRequest('请假时长字段重复');
    if (durationFields.length) durationFields[0].value = String(days);
    else formWithInvoices.push({ label: durationLabel, value: String(days) });
    const leaveTypeField = valueFields.find((field) => field.key === 'leaveType');
    const leaveType = (values?.leaveType || form.find((item) => item.label === (leaveTypeField?.label || '请假类型'))?.value || '请假').slice(0, 100);
    title = `请假申请 · ${leaveType} ${days} 天`;
    summary = `${startDate} 至 ${endDate}，共 ${days} 天`;
  }
  const invoices = Array.isArray(payload.invoices)
    ? payload.invoices.map((inv, i) => normalizeInvoiceInput(inv, i))
    : [];
  const attachments = typeKey === 'expense' && Array.isArray(payload.attachments) ? payload.attachments : [];
  if (publication && typeKey === 'expense' && invoices.length) formWithInvoices.push({ label: '发票附件', value: `${invoices.length} 张，价税合计 ¥${invoices.reduce((sum, invoice) => sum + invoice.totalAmount, 0).toFixed(2)}` });
  if (typeKey === 'expense' && invoices.length === 0) throw badRequest('请至少添加一张发票');
  if (invoices.some((invoice) => invoice.isMock)) throw badRequest('模拟识别结果不能用于报销，请使用真实发票信息');
  const branchValues = values ? { ...values } : undefined;
  if (branchValues && publication && typeKey === 'expense') branchValues.amount = expenseBranchAmount(invoices);
  const plan = publication && branchValues ? planWorkflowExecution(approvalType, publication.workflow, branchValues) : null;
  const checks = typeKey === 'expense' ? expenseVerificationSelection(plan?.steps ?? []) : { checkDuplicate: true, verifyInvoice: true };
  const invoiceKeys = checks.checkDuplicate ? invoices.map((invoice) => {
    const key = invoiceKey(invoice);
    if (!key) throw badRequest('发票号码或代码不完整，无法查重');
    return key;
  }) : [];
  if (checks.checkDuplicate && new Set(invoiceKeys).size !== invoiceKeys.length) throw badRequest('同一张发票不能在一张报销单中重复添加');
  const candidates = plan ? await getActiveApproverCandidates(plan.steps.flatMap((step) => step.kind === 'approver' ? [step.approverId] : [])) : [];
  const candidateMap = new Map(candidates.map(candidate => [candidate.id, candidate]));
  if (plan?.steps.some(step => step.kind === 'approver' && !candidateMap.has(step.approverId))) throw badRequest('审批人账号不可用，请联系管理员');
  const configuredApprover = plan ? null : await getApprovalApprover(approvalType);
  const verification: Array<{ status: string; message: string; invoice: unknown; checkedAt: string }> = [];
  if (typeKey === 'expense' && checks.verifyInvoice) await ensureInvoicesVerified(invoices, async (invoice) => {
    const result = await verifyInvoice(invoice, { skipDuplicate: !checks.checkDuplicate });
    verification.push({ status: result.status, message: result.message, invoice: result.invoice, checkedAt: new Date().toISOString() });
    return result;
  });

  const planApprovers = plan?.steps.filter((step): step is { kind: 'approver'; nodeId: string; approverId: string } => step.kind === 'approver') ?? [];
  const approverId = plan ? planApprovers[0]?.approverId ?? '' : configuredApprover!.id;
  const approverName = plan ? candidateMap.get(approverId)?.name ?? '' : configuredApprover!.name;
  const firstActionIndex = plan ? plan.steps.findIndex(step => step.kind !== 'verify') : -1;
  const hasLeader = plan ? firstActionIndex >= 0 : !!approverId;
  const status: ApprovalStatus = hasLeader ? 'pending' : plan?.outcome ?? 'approved';
  const node = hasLeader ? plan?.steps[firstActionIndex]?.kind === 'ai' ? 'AI 审批中' : `${approverName} 审批中` : status === 'rejected' ? '已驳回' : '已通过';
  const applicantDept = user.deptName.split(' · ').pop() || user.deptName;
  const timeline: TimelineNode[] = [{ name: user.name, role: '申请人', action: '提交申请', time: createdAt, state: 'done' }];
  if (plan) {
    plan.steps.forEach((step, index) => {
      if (step.kind === 'verify') {
        timeline.push({ name: '系统查验', role: '系统查验', action: index < firstActionIndex ? '查验通过' : '待处理', time: index < firstActionIndex ? createdAt : '', state: index < firstActionIndex ? 'done' : 'wait' });
      } else if (step.kind === 'ai') {
        timeline.push({ name: 'AI 审批', role: 'AI 审批', action: index === firstActionIndex ? '处理中' : '待处理', time: '', state: index === firstActionIndex ? 'current' : 'wait' });
      } else {
        const candidate = candidateMap.get(step.approverId)!;
        timeline.push({ name: candidate.name, role: candidate.jobCategory === '董事长' ? '董事长' : '审批人', action: index === firstActionIndex ? '审批中' : '待审批', time: '', state: index === firstActionIndex ? 'current' : 'wait', approverId: step.approverId });
      }
    });
  } else if (hasLeader) {
    timeline.push({ name: approverName, role: configuredApprover!.role, action: '审批中', time: '', state: 'current', approverId });
  }

  let approvalId = '';
  await transaction(async (conn) => {
    // 与确认离职使用同一把员工行锁，避免离职后并发创建待处理审批。
    for (const employeeId of [...new Set([user.id, ...(plan ? planApprovers.map(step => step.approverId) : [approverId])].filter((id) => id))].sort()) {
      const [employees] = await conn.query<RowDataPacket[]>('SELECT id FROM employees WHERE id = ? FOR UPDATE', [employeeId]);
      const [accounts] = await conn.query<RowDataPacket[]>('SELECT status FROM employee_accounts WHERE employee_id = ? FOR UPDATE', [employeeId]);
      const [departures] = await conn.query<RowDataPacket[]>("SELECT id FROM hr_employee_departures WHERE employee_id = ? AND status = 'departed' LIMIT 1 FOR UPDATE", [employeeId]);
      if (!employees.length || !accounts.length || accounts[0].status !== 'active' || departures.length) throw badRequest('申请人或审批人账号不可用，请联系管理员');
    }
    if (overtimeRange) {
      const [existingOvertime] = await conn.query<RowDataPacket[]>("SELECT status, form_json FROM approvals WHERE applicant_id = ? AND type = 'overtime' AND status IN ('pending', 'approved') FOR UPDATE", [user.id]);
      const conflict = overtimeConflictMessage(overtimeRange, existingOvertime.map(row => ({ status: String(row.status), form: storedApprovalForm(row.form_json) })));
      if (conflict) throw badRequest(conflict);
    }
    let publishedCredentials: unknown = null;
    if (publication && plan) {
      const [published] = await conn.query<RowDataPacket[]>('SELECT publication_version, credentials_json FROM custom_approval_publications WHERE approval_type = ? FOR UPDATE', [typeKey]);
      if (!published.length || Number(published[0].publication_version) !== publication.publicationVersion) throw conflict('审批流程已更新，请重新打开申请页面');
      publishedCredentials = published[0].credentials_json;
    }
    // 排序后逐一锁定，防止并发提交同一发票时同时通过查重。关闭查重的报销路径不占用发票。
    if (checks.checkDuplicate) {
      for (const key of [...invoiceKeys].sort()) {
        await conn.query('INSERT INTO invoice_identity_locks (invoice_key) VALUES (?) ON DUPLICATE KEY UPDATE invoice_key = VALUES(invoice_key)', [key]);
      }
      for (const invoice of invoices) {
        const duplicate = await checkDuplicate(invoice, conn);
        if (duplicate.blocking) throw badRequest('该发票已在审批中或已通过的单据中使用，请勿重复报销');
      }
    }
    approvalId = await insertApprovalRow(conn, now, [
      typeRow.key,
      typeRow.name,
      title,
      status,
      payload.urgent ? 1 : 0,
      user.id,
      user.name,
      applicantDept,
      user.jobCategory,
      node,
      summary,
      JSON.stringify(formWithInvoices),
      createdAt,
    ]);
    if (publication && plan) {
      await conn.execute('INSERT INTO approval_workflow_instances (approval_id, publication_version, outcome, plan_json, workflow_json, credentials_json, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())', [approvalId, publication.publicationVersion, plan.outcome, JSON.stringify(plan), JSON.stringify(publication.workflow), typeof publishedCredentials === 'string' ? publishedCredentials : JSON.stringify(publishedCredentials)]);
    }

    for (let i = 0; i < timeline.length; i += 1) {
      const n = timeline[i];
      await conn.query(
        `INSERT INTO approval_timeline
          (approval_id, step_no, name, role, action, comment, time_text, state, approver_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [approvalId, i + 1, n.name, n.role, n.action, n.comment ?? null, n.time || null, n.state, n.approverId ?? null]
      );
    }

    for (const inv of invoices) {
      await insertInvoice(conn, inv, approvalId);
    }
    if (typeKey === 'expense') {
      const loadOwned = (sql: string, params: unknown[]) => conn.query<RowDataPacket[]>(sql, params).then(([rows]) => rows as Array<{ file_id: string }>);
      const ownedAttachments = await ownedUploadIds(user.id, attachments.map((attachment) => attachment.fileID), loadOwned);
      for (const attachment of attachments) {
        if (!ownedAttachments.has(attachment.fileID)) throw badRequest('附件无效，请重新上传');
        await conn.query('INSERT INTO expense_attachments (approval_id, file_id, name) VALUES (?, ?, ?)', [approvalId, attachment.fileID, attachment.name]);
      }
      const ownedInvoices = await ownedUploadIds(user.id, invoices.map((invoice) => invoice.fileID || ''), loadOwned);
      const aiInvoices = invoices.map((invoice) => ({ ...invoice, fileID: invoice.fileID && ownedInvoices.has(invoice.fileID) ? invoice.fileID : '' }));
      const aiInput = { title, form: formWithInvoices, invoices: aiInvoices, verification, attachments };
      const hasWorkflowAi = !!plan?.steps.some(step => step.kind === 'ai');
      if (plan && hasWorkflowAi) {
        for (const [index, step] of plan.steps.entries()) if (step.kind === 'ai') {
          await conn.execute(`INSERT INTO approval_workflow_ai_jobs (approval_id, step_no, node_id, status, input_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())`, [approvalId, index + 2, step.nodeId, index === firstActionIndex ? 'queued' : 'waiting', JSON.stringify(aiInput)]);
        }
      } else if (approverId) await enqueueExpenseAi(conn, approvalId, approverId, aiInput);
    }
  });

  const detail = await getApprovalDetail(approvalId, user, { includeFlow: true });
  if (!detail) throw notFound('审批单创建失败');
  return detail;
}

export interface ApprovalActionResult {
  ok: boolean;
  finished?: boolean;
  message: string;
}

export async function submitApprovalAction(
  id: string,
  action: 'approve' | 'reject',
  comment: string,
  user: CurrentUser
): Promise<ApprovalActionResult> {
  if (action === 'reject' && !comment.trim()) {
    return { ok: false, message: '驳回时请填写审批意见' };
  }
  return transaction(async (conn) => {
    const [approvalResult] = await conn.query('SELECT * FROM approvals WHERE id = ? FOR UPDATE', [id]);
    const row = (approvalResult as ApprovalRow[])[0];
    if (!row) return { ok: false, message: '审批单不存在' };
    if (row.status !== 'pending') return { ok: false, message: '该审批单已处理，无需重复操作' };
    const [timelineResult] = await conn.query('SELECT * FROM approval_timeline WHERE approval_id = ? ORDER BY step_no', [id]);
    const timelineRows = timelineResult as TimelineRow[];
    const currentIndex = timelineRows.findIndex((n) => n.state === 'current');
    if (currentIndex < 0) return { ok: false, message: '该审批单已处理，无需重复操作' };
    const current = timelineRows[currentIndex];
    if (current.approver_id !== user.id) return { ok: false, message: '无权处理该审批单' };
    const now = formatTime(new Date(), 'YYYY-MM-DD HH:mm');
    const approved = action === 'approve';
    await conn.query(
      `UPDATE approval_timeline
       SET time_text = ?, comment = ?, action = ?, state = ?
       WHERE id = ?`,
      [now, comment || null, approved ? '已同意' : '已驳回', approved ? 'done' : 'reject', current.id]
    );

    if (approved) {
      const result = await advanceWorkflowTimeline(conn, id, current.step_no, now);
      return { ok: true, ...result };
    } else {
      for (let i = currentIndex + 1; i < timelineRows.length; i += 1) {
        const n = timelineRows[i];
        if (n.state === 'wait' || n.state === 'current') {
          await conn.query(
            'UPDATE approval_timeline SET state = ?, action = ? WHERE id = ?',
            ['stop', '已终止', n.id]
          );
        }
      }
      await conn.query("UPDATE approval_workflow_ai_jobs SET status = 'stopped', updated_at = NOW() WHERE approval_id = ? AND status IN ('waiting', 'queued', 'processing', 'failed')", [id]);
      await conn.query(
        'UPDATE approvals SET status = ?, node = ?, updated_at = ? WHERE id = ?',
        ['rejected', '已驳回', now, id]
      );
    }
    return { ok: true, finished: true, message: approved ? '已同意' : '已驳回' };
  });
}

export async function cancelApproval(id: string, user: CurrentUser): Promise<ApprovalActionResult> {
  return transaction(async (conn) => {
    const [result] = await conn.query('SELECT * FROM approvals WHERE id = ? FOR UPDATE', [id]);
    const row = (result as ApprovalRow[])[0];
    if (!row) return { ok: false, message: '审批单不存在' };
    if (row.applicant_id !== user.id) return { ok: false, message: '只能撤销自己发起的审批' };
    if (row.status !== 'pending') return { ok: false, message: '该审批单当前状态不可撤销' };
    const now = formatTime(new Date(), 'YYYY-MM-DD HH:mm');
    await conn.query(
      'UPDATE approvals SET status = ?, node = ?, updated_at = ? WHERE id = ?',
      ['cancelled', '已撤销', now, id]
    );
    await conn.query(
      `UPDATE approval_timeline SET state = 'stop', action = '已撤销', time_text = ?
       WHERE approval_id = ? AND state = 'current'`,
      [now, id]
    );
    await conn.query(
      `UPDATE approval_timeline SET state = 'stop', action = '已终止'
       WHERE approval_id = ? AND state = 'wait'`,
      [id]
    );
    await conn.query("UPDATE approval_workflow_ai_jobs SET status = 'stopped', updated_at = NOW() WHERE approval_id = ? AND status IN ('waiting', 'queued', 'processing', 'failed')", [id]);
    return { ok: true, message: '已撤销' };
  });
}
