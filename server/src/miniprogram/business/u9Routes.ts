import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { pinyin } from 'pinyin-pro';
import { config } from '../../config';
import type { U9DocumentKind, U9Gateway } from '../../domains/u9/types';
import { requireAuth } from '../auth/authMiddleware';
import { execute, queryOne, queryRows } from '../../shared/db/pool';
import { parse } from '../../shared/middleware/validate';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { badRequest, forbidden, HttpError, notFound } from '../../shared/utils/errors';
import { success } from '../../shared/utils/response';
import { documentPdf, summaryPdf } from '../../domains/u9/pdf';

const BUSINESS_MAINTENANCE_MESSAGE = '系统维护中，请 2 点后再试';

function isBusinessMaintenanceNow(): boolean {
  const start = config.u9Mirror.businessMaintenanceStartHour;
  const end = config.u9Mirror.businessMaintenanceEndHour;
  if (start === end) return false;
  const hour = new Date().getHours();
  if (start < end) return hour >= start && hour < end;
  // 跨日窗口（如 22–2）：hour >= start 或 hour < end
  return hour >= start || hour < end;
}

function rejectDuringBusinessMaintenance(_req: Request, _res: Response, next: NextFunction): void {
  if (isBusinessMaintenanceNow()) {
    next(new HttpError(503, 503, BUSINESS_MAINTENANCE_MESSAGE));
    return;
  }
  next();
}

interface NotificationRow {
  id: number;
  docNo: string;
  customerName: string;
  businessDate: string;
  totalAmount: string;
  lineCount: number;
  isRead: number;
  createdAt: string;
}
interface NotificationDetailRow extends NotificationRow {
  orgName: string;
  linesJson: unknown;
}

function parseNotificationLines(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return []; }
}

function lastMonth(): string {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function createU9BusinessRouter(u9: U9Gateway): Router {
  const router = Router();
  router.use(rejectDuringBusinessMaintenance);
  router.use(requireAuth);
  const kindSchema = z.enum(['receivables', 'receipts']);
  async function operatorFor(user: Express.Request['user']): Promise<string> {
    if (user.isChairperson || user.position !== '业务员') throw forbidden('仅业务员可访问');
    const binding = await queryOne<{ operator_id: string }>('SELECT operator_id FROM u9_employee_bindings WHERE employee_id=?', [user.id]);
    if (!binding) throw forbidden('请联系管理员绑定 U9 业务员');
    return binding.operator_id;
  }
  function notificationEmployee(user: Express.Request['user']): string {
    if (user.isChairperson || user.position !== '业务员') throw forbidden('仅业务员可访问');
    return user.id;
  }
  const pageSchema = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1) }).strict();
  const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
  const documentQuerySchema = z.object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    period: periodSchema.optional(),
    customerId: z.string().regex(/^\d{1,19}$/).optional(),
    customerKeyword: z.string().trim().min(1).max(50).optional(),
  }).strict();
  const notificationIdSchema = z.object({ id: z.coerce.number().int().positive() }).strict();
  interface CustomerSuggestion { id: string; name: string; initials: string; fullPinyin: string }
  function withPinyin(items: { id: string; name: string }[]): CustomerSuggestion[] {
    return items.map(item => ({
      id: item.id,
      name: item.name,
      initials: pinyin(item.name, { pattern: 'first', toneType: 'none', type: 'array' }).join('').toLowerCase().replace(/[^a-z]/g, ''),
      fullPinyin: pinyin(item.name, { pattern: 'pinyin', toneType: 'none', type: 'array' }).join('').toLowerCase().replace(/[^a-z]/g, ''),
    }));
  }
  const customerCache = new Map<string, { at: number; items: CustomerSuggestion[] }>();
  const CUSTOMER_CACHE_MS = 5 * 60 * 1000;
  async function customersFor(operatorId: string, period?: string): Promise<CustomerSuggestion[]> {
    const key = `receivable:${operatorId}:${period || ''}`;
    const cached = customerCache.get(key);
    if (cached && Date.now() - cached.at < CUSTOMER_CACHE_MS) return cached.items;
    const items = withPinyin(await u9.listReceivableCustomers(operatorId, period));
    customerCache.set(key, { at: Date.now(), items });
    return items;
  }
  async function receiptCustomersFor(operatorId: string, period?: string): Promise<CustomerSuggestion[]> {
    const key = `receipt:${operatorId}:${period || ''}`;
    const cached = customerCache.get(key);
    if (cached && Date.now() - cached.at < CUSTOMER_CACHE_MS) return cached.items;
    const items = withPinyin(await u9.listReceiptCustomers(operatorId, period));
    customerCache.set(key, { at: Date.now(), items });
    return items;
  }
  router.get('/summary/pdf', asyncHandler(async (req, res) => {
    const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
    const { from } = parse(z.object({ from: period }).strict(), req.query);
    const to = currentMonth();
    if (from > to) throw badRequest('请选择有效的期间');
    const operatorId = await operatorFor(req.user);
    if (!u9.getSummary) throw new Error('U9 汇总服务未配置');
    const pdf = await summaryPdf(from, to, await u9.getSummary(operatorId, from, to));
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="summary.pdf"', 'Cache-Control': 'no-store' }).send(pdf);
  }));
  router.get('/receipt-notifications/unread-count', asyncHandler(async (req, res) => {
    const employeeId = notificationEmployee(req.user);
    parse(z.object({}).strict(), req.query);
    const row = await queryOne<{ count: number }>('SELECT COUNT(*) count FROM receipt_notifications WHERE employee_id=? AND is_read=0', [employeeId]);
    success(res, { count: Number(row?.count || 0) });
  }));
  router.get('/receipt-notifications', asyncHandler(async (req, res) => {
    const employeeId = notificationEmployee(req.user);
    const { page } = parse(pageSchema, req.query);
    const rows = await queryRows<NotificationRow>(
      `SELECT id, doc_no docNo, customer_name customerName,
        DATE_FORMAT(business_date,'%Y-%m-%d 00:00:00') businessDate,
        total_amount totalAmount, line_count lineCount, is_read isRead,
        DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s') createdAt
       FROM receipt_notifications WHERE employee_id=?
       ORDER BY business_date DESC, id DESC LIMIT 50 OFFSET ?`,
      [employeeId, (page - 1) * 50]
    );
    success(res, rows.map(row => ({ ...row, isRead: Boolean(row.isRead) })));
  }));
  router.get('/receipt-notifications/:id', asyncHandler(async (req, res) => {
    const employeeId = notificationEmployee(req.user);
    const { id } = parse(notificationIdSchema, req.params);
    parse(z.object({}).strict(), req.query);
    const row = await queryOne<NotificationDetailRow>(
      `SELECT id, doc_no docNo, customer_name customerName,
        DATE_FORMAT(business_date,'%Y-%m-%d 00:00:00') businessDate,
        total_amount totalAmount, org_name orgName, line_count lineCount,
        lines_json linesJson, is_read isRead,
        DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s') createdAt
       FROM receipt_notifications WHERE id=? AND employee_id=?`,
      [id, employeeId]
    );
    if (!row) throw notFound('通知不存在');
    const { linesJson, ...rest } = row;
    success(res, { ...rest, isRead: Boolean(row.isRead), lines: parseNotificationLines(linesJson) });
  }));
  router.post('/receipt-notifications/:id/read', asyncHandler(async (req, res) => {
    const employeeId = notificationEmployee(req.user);
    const { id } = parse(notificationIdSchema, req.params);
    parse(z.object({}).strict(), req.body);
    const updated = await execute('UPDATE receipt_notifications SET is_read=1,read_at=NOW() WHERE id=? AND employee_id=?', [id, employeeId]);
    if (!updated.affectedRows) {
      const exists = await queryOne('SELECT id FROM receipt_notifications WHERE id=? AND employee_id=?', [id, employeeId]);
      if (!exists) throw notFound('通知不存在');
    }
    success(res, {});
  }));
  // 客户池接口：keyword 留空返回全量池（供小程序本地拼音联想），非空时服务端也支持名称/拼音过滤
  function filterSuggestions(items: CustomerSuggestion[], keyword?: string): CustomerSuggestion[] {
    const kw = (keyword || '').trim().toLowerCase();
    if (!kw) return items.slice(0, 500);
    return items
      .filter(item => item.name.toLowerCase().includes(kw) || item.initials.includes(kw) || item.fullPinyin.includes(kw))
      .slice(0, 20);
  }
  router.get('/receivable-customers', asyncHandler(async (req, res) => {
    const operatorId = await operatorFor(req.user);
    const { keyword, period } = parse(z.object({
      keyword: z.string().trim().max(50).optional(),
      period: periodSchema.optional(),
    }).strict(), req.query);
    success(res, filterSuggestions(await customersFor(operatorId, period), keyword));
  }));
  router.get('/receipt-customers', asyncHandler(async (req, res) => {
    const operatorId = await operatorFor(req.user);
    const { keyword, period } = parse(z.object({
      keyword: z.string().trim().max(50).optional(),
      period: periodSchema.optional(),
    }).strict(), req.query);
    success(res, filterSuggestions(await receiptCustomersFor(operatorId, period), keyword));
  }));
  router.get('/:kind', asyncHandler(async (req, res) => {
    const kind: U9DocumentKind = parse(kindSchema, req.params.kind);
    const operatorId = await operatorFor(req.user);
    if (kind === 'receivables') {
      const { page, period, customerId, customerKeyword } = parse(documentQuerySchema, req.query);
      const hasCustomer = !!(customerId || customerKeyword);
      success(res, await u9.listReceivableDocuments(operatorId, page, {
        period: period || (hasCustomer ? undefined : lastMonth()),
        customerId,
        customerKeyword,
      }));
      return;
    }
    const { page, period, customerId, customerKeyword } = parse(documentQuerySchema, req.query);
    const hasCustomer = !!(customerId || customerKeyword);
    success(res, await u9.listDocuments(kind, operatorId, page, {
      period: period || (hasCustomer ? undefined : lastMonth()),
      customerId,
      customerKeyword,
    }));
  }));
  router.get('/:kind/:id/pdf', asyncHandler(async (req, res) => {
    const kind = parse(kindSchema, req.params.kind);
    const id = parse(z.string().regex(/^\d{1,19}$/), req.params.id);
    parse(z.object({}).strict(), req.query);
    const operatorId = await operatorFor(req.user);
    const document = kind === 'receipts'
      ? await u9.getReceiptDocument(operatorId, id)
      : await u9.getReceivableDocument(operatorId, id);
    if (!document) throw notFound('单据不存在');
    const pdf = await documentPdf(kind, document);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="document.pdf"', 'Cache-Control': 'no-store' }).send(pdf);
  }));
  router.get('/:kind/:id', asyncHandler(async (req, res) => {
    const kind: U9DocumentKind = parse(kindSchema, req.params.kind);
    const id = parse(z.string().regex(/^\d{1,19}$/), req.params.id);
    parse(z.object({}).strict(), req.query);
    const operatorId = await operatorFor(req.user);
    if (kind === 'receivables') {
      const document = await u9.getReceivableDocument(operatorId, id);
      if (!document) throw notFound('单据不存在');
      success(res, document);
      return;
    }
    const document = await u9.getDocument(kind, operatorId, id);
    if (!document) throw notFound('单据不存在');
    success(res, document);
  }));
  return router;
}
