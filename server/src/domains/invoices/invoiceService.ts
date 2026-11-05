import { config } from '../../config';
import type { PoolConnection } from 'mysql2/promise';
import { execute, queryOne, queryRows } from '../../shared/db/pool';
import { badRequest } from '../../shared/utils/errors';
import type {
  ApprovalStatus,
  DuplicateHit,
  DuplicateResult,
  Invoice,
  InvoiceMeta,
  OcrResponse,
  VerifyParamSet,
  VerifyResult,
  VerifyStatus,
} from '../../shared/types/models';
import { invoiceKey, round2, toNumber } from '../../shared/utils/invoice';
import { invoices as INVOICE_SAMPLES } from '../../shared/db/invoiceSamples';
import { verifyWithTencent } from './tencentInvoiceVerifier';
export { recordInvoiceUpload } from './invoiceUploadRepository';

const STATUS: InvoiceMeta['status'] = {
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

const BLOCKING_STATUS: Record<string, boolean> = { pending: true, approved: true };

interface DuplicateRow {
  approval_id: string;
  title: string;
  applicant_name: string;
  created_at: string;
  status: ApprovalStatus;
  node: string | null;
}

interface CacheRow {
  status: VerifyStatus;
  message: string;
  invoice_json: string | Invoice | null;
  mock: number;
  verified_at: string;
}

function normalizeDate(raw: unknown): string {
  const s = String(raw || '');
  const m = s.match(/(\d{4})\D{0,2}(\d{1,2})\D{0,2}(\d{1,2})/);
  if (!m) return '';
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

export function buildVerifyParams(invoice: Invoice): VerifyParamSet {
  const isSpecial = String(invoice.invoiceType || '').includes('专用');
  const check = String(invoice.checkCode || '').replace(/[^\dA-Za-z]/g, '');
  return {
    invoiceCode: String(invoice.invoiceCode || '').trim(),
    invoiceNo: String(invoice.invoiceNumber || '').trim(),
    invoiceDate: normalizeDate(invoice.invoiceDate),
    additional: isSpecial ? String(round2(invoice.amount || 0)) : check.slice(-6),
    additionalType: isSpecial ? '不含税金额' : '校验码后6位',
  };
}

export function prepareVerify(invoice: Invoice): { params: VerifyParamSet; missing: string[]; ok: boolean } {
  const params = buildVerifyParams(invoice);
  const isSpecial = params.additionalType === '不含税金额';
  const missing: string[] = [];
  if (!params.invoiceNo) missing.push('发票号码');
  if (!params.invoiceDate) missing.push('开票日期');
  if (!params.additional || (isSpecial && Number(params.additional) <= 0)) {
    missing.push(params.additionalType);
  }
  return { params, missing, ok: missing.length === 0 };
}

export async function checkDuplicate(
  invoice: Invoice,
  connection?: PoolConnection
): Promise<DuplicateResult> {
  const key = invoiceKey(invoice);
  if (!key) {
    throw badRequest('发票号码或代码不完整，无法查重');
  }
  const digital = /^\d{20}$/.test(key);
  const legacyNumber = digital ? key : key.split('-')[1];
  const sql =
    `SELECT i.approval_id, a.title, a.applicant_name, a.created_at, a.status, a.node
     FROM invoices i
     JOIN approvals a ON a.id = i.approval_id
     WHERE (i.invoice_key = ? OR i.invoice_key = ?${digital ? ' OR i.invoice_key LIKE ?' : ''})
     ORDER BY a.created_at DESC`;
  const args: unknown[] = digital ? [key, legacyNumber, `%-${key}`] : [key, legacyNumber];
  let rows: DuplicateRow[];
  if (connection) {
    const [result] = await connection.query(sql, args);
    rows = result as DuplicateRow[];
  } else {
    rows = await queryRows<DuplicateRow>(sql, args);
  }

  const hits: DuplicateHit[] = rows.map((row) => ({
    approvalId: row.approval_id,
    title: row.title,
    applicantName: row.applicant_name,
    createdAt: String(row.created_at).slice(0, 16),
    status: row.status,
    statusText: row.node || '',
    blocking: !!BLOCKING_STATUS[row.status],
  }));

  return {
    duplicated: hits.length > 0,
    blocking: hits.some((h) => h.blocking),
    hits,
    key,
  };
}

function buildResult(
  status: VerifyStatus,
  invoice: Invoice | null,
  message: string,
  extra: {
    duplicate?: DuplicateResult | null;
    params?: VerifyParamSet | null;
    mock?: boolean;
    fromSample?: boolean;
    cached?: boolean;
  } = {}
): VerifyResult & { cached?: boolean } {
  const meta = STATUS[status] || STATUS.error;
  return {
    status,
    statusText: meta.text,
    level: meta.level,
    desc: meta.desc,
    message: message || meta.desc,
    invoice: invoice || null,
    duplicate: extra.duplicate || null,
    params: extra.params || null,
    mock: !!extra.mock,
    fromSample: !!extra.fromSample,
    cached: extra.cached,
  };
}

function sampleInvoice(sample: (typeof INVOICE_SAMPLES)[number], id: string): Invoice {
  return {
    id,
    source: 'image',
    fileID: '',
    invoiceType: sample.invoiceType,
    invoiceCode: sample.invoiceCode,
    invoiceNumber: sample.invoiceNumber,
    invoiceDate: sample.invoiceDate,
    sellerName: sample.sellerName,
    sellerTaxNo: sample.sellerTaxNo,
    buyerName: '',
    category: sample.category,
    itemName: sample.itemName,
    amount: round2(sample.amount),
    taxRate: sample.taxRate,
    taxAmount: round2(sample.taxAmount),
    totalAmount: round2(sample.totalAmount),
    checkCode: sample.checkCode,
    remark: sample.remark,
    isMock: true,
  };
}

function emptyInvoice(base: Partial<Invoice> & { id?: string }): Invoice {
  return {
    id: base.id || `inv_${Date.now()}`,
    source: 'image',
    fileID: '',
    invoiceType: base.invoiceType || '',
    invoiceCode: base.invoiceCode || '',
    invoiceNumber: base.invoiceNumber || '',
    invoiceDate: base.invoiceDate || '',
    sellerName: base.sellerName || '',
    sellerTaxNo: base.sellerTaxNo || '',
    buyerName: base.buyerName || '',
    category: base.category || '',
    itemName: base.itemName || '',
    amount: round2(base.amount),
    taxRate: base.taxRate || '',
    taxAmount: round2(base.taxAmount),
    totalAmount: round2(base.totalAmount),
    checkCode: base.checkCode || '',
    remark: base.remark || '',
    isMock: !!base.isMock,
    isQR: !!base.isQR,
    qrFrom: base.qrFrom || '',
    qrCrcVerified: !!base.qrCrcVerified,
  };
}

function parseInvoiceJson(value: string | Invoice | null): Invoice | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Invoice;
    } catch {
      return null;
    }
  }
  return value;
}

export async function verifyInvoice(invoice: Invoice): Promise<VerifyResult & { cached?: boolean }> {
  const duplicate = await checkDuplicate(invoice);
  if (duplicate.blocking) {
    const hit = duplicate.hits.find((h) => h.blocking);
    return buildResult('duplicated', null, `该发票已在「${hit ? hit.title : '其他单据'}」中报销过`, { duplicate });
  }
  if (config.verifyDriver !== 'tencent') {
    return buildResult('error', null, '真实查验通道尚未配置，请联系管理员', { duplicate });
  }
  if (!config.tencent.secretId || !config.tencent.secretKey) {
    return buildResult('error', null, '腾讯云查验凭证尚未配置，请联系管理员', { duplicate });
  }
  const key = invoiceKey(invoice);
  if (key) {
    const cache = await queryOne<CacheRow>(
      `SELECT * FROM invoice_verifications WHERE invoice_key = ? AND mock = 0 AND status = 'valid' AND verified_at >= DATE_SUB(NOW(), INTERVAL 15 MINUTE)`, [key]
    );
    const saved = cache ? parseInvoiceJson(cache.invoice_json) : null;
    if (saved && saved.invoiceNumber === invoice.invoiceNumber && saved.invoiceCode === invoice.invoiceCode && saved.invoiceDate === invoice.invoiceDate && saved.invoiceType === invoice.invoiceType && saved.totalAmount === invoice.totalAmount && (invoice.invoiceNumber.length === 20 || saved.amount === invoice.amount) && saved.checkCode === invoice.checkCode) {
      return buildResult('valid', saved, cache!.message, { duplicate, cached: true });
    }
  }
  const outcome = await verifyWithTencent(invoice, config.tencent);
  if (key && outcome.status === 'valid' && outcome.invoice) {
    await execute(
      `INSERT INTO invoice_verifications (invoice_key, status, message, invoice_json, mock, verified_at)
       VALUES (?, ?, ?, ?, 0, NOW()) ON DUPLICATE KEY UPDATE status = VALUES(status), message = VALUES(message), invoice_json = VALUES(invoice_json), mock = 0, verified_at = NOW()`,
      [key, outcome.status, outcome.message, JSON.stringify(outcome.invoice)]
    );
  }
  return buildResult(outcome.status, outcome.invoice || null, outcome.message, { duplicate });
}

export function getInvoiceMeta(): InvoiceMeta {
  return {
    ocrDriver: config.ocrDriver,
    verifyDriver: config.verifyDriver,
    mockRules: MOCK_RULES,
    status: STATUS,
  };
}

/** 服务端 mock OCR：按 index 轮换返回预置样本 */
export function recognizeInvoice(index = 0, fileUrl = ''): OcrResponse {
  if (config.ocrDriver !== 'mock') {
    throw new Error('OCR 驱动尚未配置（OCR_DRIVER=mock）');
  }
  const sample = INVOICE_SAMPLES[Math.abs(index) % INVOICE_SAMPLES.length];
  const invoice = sampleInvoice(sample, `ocr_${Date.now()}_${index}`) as Invoice & {
    __mock?: boolean;
    __fromQR?: boolean;
  };
  invoice.isMock = true;
  invoice.__mock = true;
  return { invoice, fileUrl };
}
