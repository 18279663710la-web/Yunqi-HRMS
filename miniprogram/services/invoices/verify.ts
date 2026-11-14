/**
 * services/verify.ts — 发票查重 / 查验（TypeScript）
 *
 * 前端只负责收集与展示；查重扫描全公司单据、查验比对税局数据都在服务端完成。
 *   · 查重：POST /invoices/duplicate
 *   · 查验：POST /invoices/verify
 *   · 驱动信息：GET /invoices/meta
 */

import type {
  DuplicateResult,
  Invoice,
  InvoiceMeta,
  VerifyResult,
  VerifyStatus,
  VerifyStatusMeta,
} from '../../types/models';
import { get, post } from '../../utils/request';
export { invoiceKey } from '../../utils/invoice-identity';

const STATUS: Record<VerifyStatus, VerifyStatusMeta> = {
  abnormal: { key: 'abnormal', text: '发票状态异常', level: 'fail', desc: '发票已作废、红冲或为红字发票，请人工复核' },
  valid: {
    key: 'valid',
    text: '查验通过',
    level: 'ok',
    desc: '税局返回的票面信息与提交内容一致',
  },
  notFound: {
    key: 'notFound',
    text: '查无此票',
    level: 'fail',
    desc: '税局系统中未查到该发票，可能是假票或信息录入有误',
  },
  mismatch: {
    key: 'mismatch',
    text: '信息不一致',
    level: 'fail',
    desc: '票面信息与税局记录不符，请核对发票代码、号码与金额',
  },
  duplicated: {
    key: 'duplicated',
    text: '重复报销',
    level: 'fail',
    desc: '该发票已在本单位其他单据中出现过',
  },
  limitExceeded: {
    key: 'limitExceeded',
    text: '超出查验次数',
    level: 'warn',
    desc: '同一张发票每天最多查验 5 次，请次日再试',
  },
  invalid: {
    key: 'invalid',
    text: '参数不完整',
    level: 'warn',
    desc: '缺少查验必需的字段，无法提交核验',
  },
  error: {
    key: 'error',
    text: '查验失败',
    level: 'fail',
    desc: '核验服务异常，请稍后重试',
  },
};

const MOCK_RULES = [
  '发票号码命中预置样本（5 张）→ 查验通过',
  '发票号码以 9 结尾 → 查无此票',
  '发票号码以 4 结尾 → 信息不一致',
  '其余号码 → 查验通过',
];

/** 查重：服务端扫描全部单据的发票附件 */
export function checkDuplicate(
  invoice: Partial<Invoice>
): Promise<DuplicateResult> {
  return post<DuplicateResult>('/invoices/duplicate', { invoice });
}

/** 查重前置检查：blocked=true 时应阻止提交 */
export async function preCheck(
  invoice: Partial<Invoice>
): Promise<{ blocked: boolean; duplicated: boolean; hits: DuplicateResult['hits']; message: string }> {
  const dup = await checkDuplicate(invoice);
  const hit = dup.hits.find((h) => h.blocking);
  return {
    blocked: dup.blocking,
    duplicated: dup.duplicated,
    hits: dup.hits,
    message: dup.blocking && hit ? `该发票已在「${hit.title}」中报销过` : '',
  };
}

/** 查验真伪。skipDuplicate 时不再因重复报销提前返回，供已关闭查重的报销节点使用。 */
export function verifyInvoice(invoice: Partial<Invoice>, options?: { skipDuplicate?: boolean }): Promise<VerifyResult> {
  return post<VerifyResult>('/invoices/verify', { invoice, ...(options?.skipDuplicate ? { skipDuplicate: true } : {}) }, { timeout: 25000 });
}

/** 批量查验（串行，避免触发频次限制） */
export async function verifyBatch(list: Invoice[] = []): Promise<{
  results: Array<VerifyResult & { invoice: Invoice }>;
  summary: { total: number; passed: number; failed: number; duplicated: number; pending: number };
}> {
  const results: Array<VerifyResult & { invoice: Invoice }> = [];
  for (const invoice of list) {
    const result = await verifyInvoice(invoice);
    results.push({ ...result, invoice: result.invoice || invoice });
  }

  const summary = results.reduce(
    (acc, r) => {
      acc.total += 1;
      if (r.status === 'valid') acc.passed += 1;
      else if (r.status === 'duplicated') acc.duplicated += 1;
      else if (r.level === 'fail') acc.failed += 1;
      else acc.pending += 1;
      return acc;
    },
    { total: 0, passed: 0, failed: 0, duplicated: 0, pending: 0 }
  );

  return { results, summary };
}

/** 当前 OCR / 查验驱动与 mock 规则（发票工具台展示） */
export function getMeta(): Promise<InvoiceMeta> {
  return get<InvoiceMeta>('/invoices/meta');
}

export function getStatusMeta(status: VerifyStatus): VerifyStatusMeta {
  return STATUS[status] || STATUS.error;
}

export { MOCK_RULES, STATUS };
