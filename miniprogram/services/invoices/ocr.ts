/**
 * services/ocr.ts — 发票识别层（TypeScript）
 *
 * 前端保留两部分能力：
 *   1. 发票二维码解析（国标字段，纯本地、零成本、准确率 100%）
 *   2. 调用后端 /ocr/invoice 做票面 OCR（图片上传，密钥与识别逻辑都在服务端）
 *
 * 说明：原 mock 样本与归一化逻辑位于服务端发票业务模块。
 */

import type { Invoice, ParsedInvoiceQR } from '../../types/models';
import { upload, resolveFileUrl } from '../../utils/request';
import { pad } from '../../utils/util';

export interface RecognizeOptions {
  filePath: string;
  /** 同一批图片的序号，mock 驱动据此轮换样本 */
  index?: number;
}

export interface VerifyParams {
  invoiceCode: string;
  invoiceNo: string;
  invoiceDate: string;
  additional: string;
  additionalType: string;
}

const CATEGORY_TO_EXPENSE_TYPE: Record<string, string> = {
  餐饮: '招待费',
  交通: '差旅费',
  服务: '差旅费',
  日用品食品: '办公用品',
  电器设备: '办公用品',
  通讯: '办公用品',
  医疗: '其他',
  其他: '其他',
};

/* ---------------- 工具 ---------------- */

function round2(n: unknown): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** '2026年10月08日' / '2026/10/8' / '2026-10-08' -> '2026-10-08' */
export function normalizeDate(raw: unknown): string {
  const s = String(raw || '');
  const m = s.match(/(\d{4})\D{0,2}(\d{1,2})\D{0,2}(\d{1,2})/);
  if (!m) return '';
  return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
}

/** 去掉货币符号后转数字 */
export function toNumber(raw: unknown): number {
  const n = Number(String(raw == null ? '' : raw).replace(/[^\d.-]/g, ''));
  return Number.isNaN(n) ? 0 : n;
}

/** 统一发票结构（空值兜底） */
export function emptyInvoice(): Invoice {
  return {
    id: '',
    source: 'image',
    fileID: '',
    invoiceType: '',
    invoiceCode: '',
    invoiceNumber: '',
    invoiceDate: '',
    sellerName: '',
    sellerTaxNo: '',
    buyerName: '',
    category: '',
    itemName: '',
    amount: 0,
    taxRate: '',
    taxAmount: 0,
    totalAmount: 0,
    checkCode: '',
    remark: '',
    isMock: false,
    isQR: false,
    qrFrom: '',
    qrCrcVerified: false,
  };
}

/* ---------------- 发票二维码 ---------------- */

const QR_TYPE_CODE: Record<string, string> = {
  '10': '增值税电子普通发票',
  '20': '增值税电子专用发票',
};

/**
 * CRC-16/UMTS：多项式 0x8005，初值 0，不反射，结果不异或。
 * 目前只用于实测匹配的 ASCII 数电票二维码，不作为真伪依据。
 */
export function crc16UmtsHex(text: string): string {
  if (/[^\x00-\x7f]/.test(text)) throw new Error('CRC 内容必须为 ASCII');
  let crc = 0x0000;
  for (let i = 0; i < text.length; i += 1) {
    crc ^= text.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x8005) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  const hex = (crc & 0xffff).toString(16).toUpperCase();
  return '0000'.slice(hex.length) + hex;
}

function normalizeCompactDate(raw: unknown): string {
  const s = String(raw || '').trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return normalizeDate(s);
}

/**
 * 解析发票二维码文本
 *
 * 读取逗号分隔字段；仅对样本验证过的 01/32 数电票格式进行 CRC 自检。
 */
export function parseInvoiceQR(raw: unknown): ParsedInvoiceQR {
  const text = String(raw == null ? '' : raw).trim().replace(/^["']|["']$/g, '');
  if (!text) return { ok: false, message: '二维码内容为空' };

  const parts = text.split(',').map((s) => s.trim());
  if (parts.length < 6) return { ok: false, message: '暂不支持此二维码格式，请使用支持的发票二维码' };
  if (!/^\d{2}$/.test(parts[0])) return { ok: false, message: '暂不支持此二维码格式，请使用支持的发票二维码' };

  const invoiceNumber = parts[3] || '';
  if (!invoiceNumber) return { ok: false, message: '不是发票二维码（缺少发票号码）' };

  const crc = parts.length >= 8 ? (parts[7] || '').toUpperCase() : '';
  const typeCode = parts[1] || '';
  const supportedCrc = parts.length === 8 && parts[0] === '01' && typeCode === '32'
    && !parts[2] && /^\d{20}$/.test(invoiceNumber) && !parts[6]
    && /^[\da-fA-F]{4}$/.test(crc) && /^[\x00-\x7f]+$/.test(text);
  // 分隔符也参与计算，保留原始字节，不能先对各字段 trim 后重新拼接。
  const crcCalc = supportedCrc ? crc16UmtsHex(text.slice(0, text.lastIndexOf(',') + 1)) : undefined;

  return {
    ok: true,
    raw: text,
    version: parts[0],
    typeCode,
    typeName: QR_TYPE_CODE[typeCode] || '增值税电子发票',
    invoiceCode: parts[2] || '',
    invoiceNumber,
    totalAmount: round2(toNumber(parts[4])),
    invoiceDate: normalizeCompactDate(parts[5]),
    checkCode: parts[6] || '',
    crc,
    crcCalc,
    crcVerified: crcCalc === undefined ? undefined : crc === crcCalc,
  };
}

/** 不支持的格式明确标为未验证，不能当成校验失败。 */
export function formatInvoiceCrc(parsed: ParsedInvoiceQR): string {
  if (!parsed.crc) return '—';
  if (parsed.crcVerified === true) return `${parsed.crc}（自检通过）`;
  if (parsed.crcVerified === false) return `${parsed.crc}（自检未通过，计算值 ${parsed.crcCalc}）`;
  return `${parsed.crc}（未验证）`;
}

/** 调起扫一扫并解析发票二维码 */
export function scanInvoiceQR(): Promise<ParsedInvoiceQR> {
  return new Promise((resolve, reject) => {
    if (typeof wx === 'undefined' || !wx.scanCode) {
      reject({ code: -1, message: '当前环境不支持扫码' });
      return;
    }
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['qrCode'],
      success: (res) => {
        const parsed = parseInvoiceQR(res && res.result);
        if (!parsed.ok) reject({ code: -3, message: parsed.message || '不是发票二维码' });
        else resolve(parsed);
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        if (msg.includes('cancel')) reject({ code: 0, cancelled: true, message: '已取消扫码' });
        else reject({ code: -4, message: '扫码失败，请重试' });
      },
    });
  });
}

/** 二维码解析结果 -> 统一发票结构（补齐二维码里没有的字段） */
export function buildFromQR(parsed: ParsedInvoiceQR): Invoice | null {
  if (!parsed || !parsed.ok) return null;
  return {
    ...emptyInvoice(),
    invoiceType: parsed.typeName || '增值税电子发票',
    invoiceCode: parsed.invoiceCode || '',
    invoiceNumber: parsed.invoiceNumber || '',
    invoiceDate: parsed.invoiceDate || '',
    amount: parsed.totalAmount || 0,
    taxRate: '—',
    taxAmount: 0,
    totalAmount: parsed.totalAmount || 0,
    checkCode: parsed.checkCode || '',
    isQR: true,
    qrFrom: 'scan',
    qrCrcVerified: !!parsed.crcVerified,
  };
}

/**
 * 组装查验入参
 * 专用发票传不含税金额，普通发票传校验码后 6 位。
 */
export function buildVerifyParams(invoice: Partial<Invoice>): VerifyParams {
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

/* ---------------- 服务端 OCR ---------------- */

interface OcrApiResponse {
  invoice: Invoice;
  fileUrl: string;
}

/**
 * 识别单张发票：把图片上传到后端，由服务端做 OCR。
 * 返回统一发票结构，fileID 指向服务端可访问的图片 URL。
 */
export async function recognizeInvoice(options: RecognizeOptions): Promise<Invoice> {
  const { filePath, index = 0 } = options;
  if (!filePath) throw { code: -1, message: '缺少发票图片' };

  const data = await upload<OcrApiResponse>({
    url: '/ocr/invoice',
    filePath,
    name: 'file',
    formData: { index },
  });

  return {
    ...emptyInvoice(),
    ...data.invoice,
    fileID: resolveFileUrl(data.fileUrl),
    isMock: !!data.invoice.isMock,
  };
}

/** 多张发票金额汇总 */
export function sumInvoices(list: Invoice[] = []): {
  count: number;
  totalAmount: number;
  taxAmount: number;
} {
  return {
    count: list.length,
    totalAmount: round2(list.reduce((sum, item) => sum + toNumber(item && item.totalAmount), 0)),
    taxAmount: round2(list.reduce((sum, item) => sum + toNumber(item && item.taxAmount), 0)),
  };
}

/** 发票消费类型 -> 报销类型 */
export function mapCategoryToExpenseType(category: string): string {
  return CATEGORY_TO_EXPENSE_TYPE[category] || '其他';
}

export { CATEGORY_TO_EXPENSE_TYPE };
