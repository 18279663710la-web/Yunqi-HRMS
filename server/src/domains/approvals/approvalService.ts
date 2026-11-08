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
import { badRequest, notFound } from '../../shared/utils/errors';
import { invoiceKey, randomDigits, round2 } from '../../shared/utils/invoice';
import { calculateLeaveDays } from '../../shared/utils/leaveDuration';
import { checkDuplicate, verifyInvoice } from '../invoices/invoiceService';
import { ensureInvoicesVerified } from '../invoices/tencentInvoiceVerifier';
import { getApprovalApprover, parseApproverType, chairpersonCanApprove } from './expenseApproverService';
import { enqueueExpenseAi, getExpenseAiAdvice, generateExpenseAdvice } from './expenseAiService';
import { getExpenseRules } from './expenseRulesService';
import { config } from '../../config';
import { CHAIRPERSON_ID } from '../accounts/chairpersonService';
import type { RowDataPacket } from 'mysql2';

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
  };
}

async function loadApprovalRows(): Promise<ApprovalRow[]> {
  return queryRows<ApprovalRow>(
    `SELECT a.*, CASE WHEN a.applicant_position IN ('研发员', '业务员', '员工') OR EXISTS
       (SELECT 1 FROM job_titles t WHERE t.name = a.applicant_position)
       THEN a.applicant_position ELSE COALESCE(e.position, a.applicant_position) END AS applicant_position
     FROM approvals a LEFT JOIN employees e ON e.id = a.applicant_id
     ORDER BY a.urgent DESC, a.created_at DESC, a.id DESC`
  );
}

async function loadTimelineRows(): Promise<TimelineRow[]> {
  return queryRows<TimelineRow>(
    'SELECT * FROM approval_timeline ORDER BY approval_id, step_no'
  );
}

async function loadInvoiceRows(): Promise<InvoiceRow[]> {
  return queryRows<InvoiceRow>(
    'SELECT * FROM invoices WHERE approval_id IS NOT NULL ORDER BY created_at, id'
  );
}

async function loadAllApprovals(): Promise<Approval[]> {
  const [rows, timelineRows, invoiceRows] = await Promise.all([
    loadApprovalRows(),
    loadTimelineRows(),
    loadInvoiceRows(),
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

  return rows.map((row) =>
    toApproval(row, timelineMap.get(row.id) || [], invoiceMap.get(row.id) || [])
  );
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

export async function getApprovalList(
  tab: 'pending' | 'mine' | 'done',
  user: CurrentUser
): Promise<ApprovalDecorated[]> {
  const list = await loadAllApprovals();
  const visible = user.isChairperson ? list.filter((a) => chairpersonCanApprove(a.type) && a.timeline.some((n) => n.approverId === user.id)) : list;
  let filtered: Approval[];

  if (tab === 'pending') {
    filtered = visible.filter((a) => isPendingForMe(a, user));
  } else if (tab === 'mine') {
    filtered = visible.filter((a) => a.applicantId === user.id);
  } else {
    filtered = visible.filter((a) => a.status === 'approved' || a.status === 'rejected');
  }

  filtered.sort((a, b) => {
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    return b.createdAt.localeCompare(a.createdAt);
  });

  return filtered.map((a) => decorateApproval(a, user));
}

export async function getApprovalTabCounts(user: CurrentUser): Promise<ApprovalTabCounts> {
  const all = await loadAllApprovals();
  const list = user.isChairperson ? all.filter((a) => chairpersonCanApprove(a.type) && a.timeline.some((n) => n.approverId === user.id)) : all;
  return {
    pending: list.filter((a) => isPendingForMe(a, user)).length,
    mine: list.filter((a) => a.applicantId === user.id).length,
    done: list.filter((a) => a.status === 'approved' || a.status === 'rejected').length,
  };
}

export async function getPendingCount(user: CurrentUser): Promise<number> {
  const list = await loadAllApprovals();
  return list.filter((a) => (!user.isChairperson || chairpersonCanApprove(a.type)) && isPendingForMe(a, user)).length;
}

export async function getApprovalDetail(id: string, user: CurrentUser): Promise<ApprovalDetail | null> {
  const list = await loadAllApprovals();
  const a = list.find((item) => item.id === id);
  if (!a) return null;
  if (user.isChairperson && (!chairpersonCanApprove(a.type) || !a.timeline.some((n) => n.approverId === user.id))) return null;
  const decorated = decorateApproval(a, user);
  const attachments = a.type === 'expense' ? await queryRows<{ name: string; fileID: string }>('SELECT name, file_id AS fileID FROM expense_attachments WHERE approval_id = ? ORDER BY id', [a.id]) : [];
  const aiAdvice = a.type === 'expense' && a.timeline.some((node) => node.approverId === user.id)
    ? await getExpenseAiAdvice(a.id, user.id) : null;
  return {
    ...decorated,
    attachments,
    aiAdvice,
    canApprove: a.status === 'pending' && isPendingForMe(a, user),
    canCancel: a.status === 'pending' && a.applicantId === user.id,
  };
}

async function nextApprovalId(): Promise<string> {
  const prefix = `FA${formatTime(new Date(), 'YYYYMMDD')}`;
  for (let i = 0; i < 30; i += 1) {
    const id = `${prefix}${randomDigits(3)}`;
    const exists = await queryOne<{ id: string }>('SELECT id FROM approvals WHERE id = ?', [id]);
    if (!exists) return id;
  }
  return `${prefix}${Date.now().toString().slice(-3)}`;
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

/** 提交前检查材料，不创建审批单，也不改变发票占用状态。 */
export async function previewExpenseApproval(payload: CreateApprovalPayload, user: CurrentUser, options?: { onProgress?: (text: string) => void; signal?: AbortSignal }) {
  if (payload.type !== 'expense') throw badRequest('仅支持报销预审');
  const invoices = Array.isArray(payload.invoices) ? payload.invoices.map((invoice, i) => normalizeInvoiceInput(invoice, i)) : [];
  if (!invoices.length) throw badRequest('请至少添加一张发票');
  const keys = invoices.map((invoice) => {
    if (invoice.isMock) throw badRequest('模拟发票不能用于预审');
    const key = invoiceKey(invoice);
    if (!key) throw badRequest('发票号码或代码不完整');
    return key;
  });
  if (new Set(keys).size !== keys.length) throw badRequest('同一张发票不能重复添加');
  const attachments = payload.attachments || [];
  for (const file of [...attachments.map((item) => item.fileID), ...invoices.map((item) => item.fileID || '').filter(Boolean)]) {
    if (!await queryOne('SELECT file_id FROM expense_uploads WHERE file_id = ? AND owner_id = ?', [file, user.id])) throw badRequest('附件无效，请重新上传');
  }
  const verification: Array<{ status: string; message: string; invoice: unknown; checkedAt: string }> = [];
  await ensureInvoicesVerified(invoices, async (invoice) => {
    const result = await verifyInvoice(invoice);
    verification.push({ status: result.status, message: result.message, invoice: result.invoice, checkedAt: new Date().toISOString() });
    return result;
  });
  const rules = await getExpenseRules();
  if (!rules.content.trim()) return { status: 'no_rules', advice: null };
  if (config.expenseAi.driver === 'deepseek' && !config.expenseAi.apiKey) return { status: 'unconfigured', advice: null };
  try {
    const advice = await generateExpenseAdvice({ title: payload.title || '报销申请', form: payload.form || [], invoices, verification, attachments }, rules.content.trim(), options);
    return { status: 'completed', advice };
  } catch {
    return { status: 'failed', advice: null };
  }
}

export async function getLeaveApprover(_user: CurrentUser): Promise<{ id: string; name: string; role: string }> {
  return getApprovalApprover('leave');
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

  const now = new Date();
  const createdAt = formatTime(now, 'YYYY-MM-DD HH:mm');
  const id = await nextApprovalId();
  let title = String(payload.title || '').trim() || `${typeRow.name}申请`;
  let summary = String(payload.summary || '').trim();
  const form = Array.isArray(payload.form)
    ? payload.form
        .filter((f) => f && typeof f.label === 'string')
        .map((f) => ({ label: String(f.label), value: String(f.value ?? '') }))
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
  if (typeKey === 'leave') {
    const getField = (label: string): string => {
      const matches = form.filter((item) => item.label === label);
      if (matches.length !== 1) throw badRequest(`请填写有效的${label}`);
      return matches[0].value.trim();
    };
    const startDate = getField('开始日期');
    const startTime = getField('开始时间');
    const endDate = getField('结束日期');
    const endTime = getField('结束时间');
    const days = calculateLeaveDays(startDate, startTime, endDate, endTime);
    if (days === null) throw badRequest('请假结束时间须晚于开始时间');
    const durationFields = formWithInvoices.filter((item) => item.label === '请假时长（天）');
    if (durationFields.length > 1) throw badRequest('请假时长字段重复');
    if (durationFields.length) durationFields[0].value = String(days);
    else formWithInvoices.push({ label: '请假时长（天）', value: String(days) });
    const leaveType = (form.find((item) => item.label === '请假类型')?.value || '请假').slice(0, 100);
    title = `请假申请 · ${leaveType} ${days} 天`;
    summary = `${startDate} 至 ${endDate}，共 ${days} 天`;
  }
  const invoices = Array.isArray(payload.invoices)
    ? payload.invoices.map((inv, i) => normalizeInvoiceInput(inv, i))
    : [];
  const attachments = typeKey === 'expense' && Array.isArray(payload.attachments) ? payload.attachments : [];
  if (typeKey === 'expense' && invoices.length === 0) throw badRequest('请至少添加一张发票');
  const invoiceKeys = invoices.map((invoice) => {
    if (invoice.isMock) throw badRequest('模拟识别结果不能用于报销，请使用真实发票信息');
    const key = invoiceKey(invoice);
    if (!key) throw badRequest('发票号码或代码不完整，无法查重');
    return key;
  });
  if (new Set(invoiceKeys).size !== invoiceKeys.length) throw badRequest('同一张发票不能在一张报销单中重复添加');
  const configuredApprover = await getApprovalApprover(parseApproverType(typeKey));
  const verification: Array<{ status: string; message: string; invoice: unknown; checkedAt: string }> = [];
  if (typeKey === 'expense') await ensureInvoicesVerified(invoices, async (invoice) => {
    const result = await verifyInvoice(invoice);
    verification.push({ status: result.status, message: result.message, invoice: result.invoice, checkedAt: new Date().toISOString() });
    return result;
  });

  const approverId = configuredApprover.id;
  const approverName = configuredApprover.name;
  const hasLeader = !!approverId;
  const status: ApprovalStatus = hasLeader ? 'pending' : 'approved';
  const node = hasLeader ? `${approverName} 审批中` : '已通过';
  const applicantDept = user.deptName.split(' · ').pop() || user.deptName;

  const timeline: TimelineNode[] = [
    {
      name: user.name,
      role: '申请人',
      action: '提交申请',
      time: createdAt,
      state: 'done',
    },
  ];
  if (hasLeader) {
    timeline.push({
      name: approverName,
      role: configuredApprover.role,
      action: '审批中',
      time: '',
      state: 'current',
      approverId,
    });
  }

  await transaction(async (conn) => {
    // 与确认离职使用同一把员工行锁，避免离职后并发创建待处理审批。
    for (const employeeId of [...new Set([user.id, approverId].filter((id) => id && id !== CHAIRPERSON_ID))].sort()) {
      const [employees] = await conn.query<RowDataPacket[]>('SELECT id FROM employees WHERE id = ? FOR UPDATE', [employeeId]);
      const [accounts] = await conn.query<RowDataPacket[]>('SELECT status FROM employee_accounts WHERE employee_id = ?', [employeeId]);
      const [departures] = await conn.query<RowDataPacket[]>("SELECT id FROM hr_employee_departures WHERE employee_id = ? AND status = 'departed' LIMIT 1", [employeeId]);
      if (!employees.length || !accounts.length || accounts[0].status !== 'active' || departures.length) throw badRequest('申请人或审批人账号不可用，请联系管理员');
    }
    // 排序后逐一锁定，防止并发提交同一发票时同时通过查重。
    for (const key of [...invoiceKeys].sort()) {
      await conn.query('INSERT INTO invoice_identity_locks (invoice_key) VALUES (?) ON DUPLICATE KEY UPDATE invoice_key = VALUES(invoice_key)', [key]);
    }
    for (const invoice of invoices) {
      const duplicate = await checkDuplicate(invoice, conn);
      if (duplicate.blocking) throw badRequest('该发票已在审批中或已通过的单据中使用，请勿重复报销');
    }
    await conn.query(
      `INSERT INTO approvals
        (id, type, type_name, title, status, urgent, applicant_id, applicant_name, applicant_dept,
         applicant_position, node, summary, form_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        id,
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
      ]
    );

    for (let i = 0; i < timeline.length; i += 1) {
      const n = timeline[i];
      await conn.query(
        `INSERT INTO approval_timeline
          (approval_id, step_no, name, role, action, comment, time_text, state, approver_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, i + 1, n.name, n.role, n.action, n.comment ?? null, n.time || null, n.state, n.approverId ?? null]
      );
    }

    for (const inv of invoices) {
      await insertInvoice(conn, inv, id);
    }
    if (typeKey === 'expense' && approverId) {
      for (const attachment of attachments) {
        const [owned] = await conn.query('SELECT file_id FROM expense_uploads WHERE file_id = ? AND owner_id = ?', [attachment.fileID, user.id]);
        if (!(owned as unknown[]).length) throw badRequest('附件无效，请重新上传');
        await conn.query('INSERT INTO expense_attachments (approval_id, file_id, name) VALUES (?, ?, ?)', [id, attachment.fileID, attachment.name]);
      }
      const aiInvoices = [];
      for (const invoice of invoices) {
        const [owned] = await conn.query('SELECT file_id FROM expense_uploads WHERE file_id = ? AND owner_id = ?', [invoice.fileID || '', user.id]);
        aiInvoices.push({ ...invoice, fileID: (owned as unknown[]).length ? invoice.fileID : '' });
      }
      await enqueueExpenseAi(conn, id, approverId, { title, form: formWithInvoices, invoices: aiInvoices, verification, attachments });
    }
  });

  const detail = await getApprovalDetail(id, user);
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
    if (user.isChairperson && !chairpersonCanApprove(row.type)) return { ok: false, message: '无权处理该审批单' };
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
      const next = timelineRows.find((n, i) => i > currentIndex && n.state === 'wait');
      if (next) {
        await conn.query(
          'UPDATE approval_timeline SET state = ?, action = ? WHERE id = ?',
          ['current', '审批中', next.id]
        );
        await conn.query(
          'UPDATE approvals SET status = ?, node = ?, updated_at = ? WHERE id = ?',
          ['pending', `${next.name} 审批中`, now, id]
        );
        return { ok: true, finished: false, message: `已同意，流转至${next.name}` };
      } else {
        await conn.query(
          'UPDATE approvals SET status = ?, node = ?, updated_at = ? WHERE id = ?',
          ['approved', '已通过', now, id]
        );
      }
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
    return { ok: true, message: '已撤销' };
  });
}
