import { ocr } from 'tencentcloud-sdk-nodejs-ocr';
import type { Invoice, VerifyStatus } from '../../shared/types/models';
import { badRequest } from '../../shared/utils/errors';

type Request = { InvoiceNo: string; InvoiceDate: string; InvoiceCode?: string; InvoiceKind?: string; CheckCode?: string; Amount?: string; EnableTodayInvoice: boolean };
type TencentInvoice = { Number?: string | null; IsAbandoned?: string | null; RedLetterInvoiceMark?: boolean | null; AmountWithTax?: string | null; AmountWithoutTax?: string | null; TaxAmount?: string | null; SellerName?: string | null; SellerTaxCode?: string | null; BuyerName?: string | null };
type Outcome = { status: VerifyStatus; message: string; invoice?: Invoice };

const VERIFY_CONCURRENCY = 3;

export async function ensureInvoicesVerified(invoices: Invoice[], verify: (invoice: Invoice) => Promise<{ status: VerifyStatus; mock: boolean; message: string }>): Promise<void> {
  const failures: Array<{ index: number; error: unknown }> = [];
  let next = 0;
  let failedAt = invoices.length;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (next >= invoices.length || next >= failedAt) return;
      const index = next;
      next += 1;
      try {
        const result = await verify(invoices[index]);
        if (result.status !== 'valid' || result.mock) throw badRequest(result.message || '发票尚未通过真实查验');
      } catch (error) {
        failures.push({ index, error });
        if (index < failedAt) failedAt = index;
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(VERIFY_CONCURRENCY, invoices.length) }, () => worker()));
  if (!failures.length) return;
  failures.sort((left, right) => left.index - right.index);
  throw failures[0].error;
}

export function buildTencentInvoiceRequest(invoice: Invoice): Request {
  const no = String(invoice.invoiceNumber || '').trim();
  const date = String(invoice.invoiceDate || '').trim();
  if (!/^\d{8}$|^\d{20}$/.test(no)) throw new Error('发票号码不完整');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('开票日期不正确');
  const request: Request = { InvoiceNo: no, InvoiceDate: date, EnableTodayInvoice: true };
  if (no.length === 20) {
    if (!Number.isFinite(invoice.totalAmount) || invoice.totalAmount <= 0) throw new Error('缺少有效的价税合计');
    request.Amount = invoice.totalAmount.toFixed(2);
    return request;
  }
  const code = String(invoice.invoiceCode || '').trim();
  if (!/^\d{10}$|^\d{12}$/.test(code)) throw new Error('发票代码不完整');
  request.InvoiceCode = code;
  if (invoice.invoiceType === '增值税电子普通发票') {
    const check = String(invoice.checkCode || '').trim();
    if (!/^\d{6,}$/.test(check)) throw new Error('缺少校验码后 6 位');
    request.InvoiceKind = '10';
    request.CheckCode = check.slice(-6);
  } else if (invoice.invoiceType === '增值税电子专用发票') {
    if (!Number.isFinite(invoice.amount) || invoice.amount <= 0) throw new Error('缺少不含税金额');
    request.InvoiceKind = '08';
    request.Amount = invoice.amount.toFixed(2);
  } else throw new Error('无法确定传统发票票种，请人工复核');
  return request;
}

export function interpretTencentInvoice(input: Invoice, response: { Invoice?: TencentInvoice | null }): Outcome {
  const result = response.Invoice;
  if (!result || !result.Number) return { status: 'error', message: '查验结果缺少票面信息，请人工复核' };
  if (result.Number !== input.invoiceNumber) return { status: 'mismatch', message: '查验返回的发票号码与提交信息不一致' };
  if (input.invoiceNumber.length === 20 && (!result.AmountWithTax || !Number.isFinite(Number(result.AmountWithTax)) || Math.round(Number(result.AmountWithTax) * 100) !== Math.round(input.totalAmount * 100))) return { status: 'mismatch', message: '查验返回的价税合计与提交信息不一致' };
  if (['Y', 'H', 'HP', 'HF'].includes(result.IsAbandoned || '') || result.RedLetterInvoiceMark === true) return { status: 'abnormal', message: '发票已作废、红冲或为红字发票，请人工复核' };
  if (result.IsAbandoned !== 'N' || result.RedLetterInvoiceMark !== false) return { status: 'error', message: '查验返回的票据状态不明确，请人工复核' };
  return { status: 'valid', message: '发票信息核验通过', invoice: { ...input, sellerName: result.SellerName || '', sellerTaxNo: result.SellerTaxCode || '', buyerName: result.BuyerName || '', amount: Number(result.AmountWithoutTax) || 0, taxAmount: Number(result.TaxAmount) || 0 } };
}

export function interpretTencentError(error: unknown): Outcome {
  const code = String((error as { code?: unknown })?.code || '');
  if (code === 'ResourceNotFound.NoInvoice') return { status: 'notFound', message: '查无此票，可能尚未同步或信息有误，请稍后或通过税务平台复核' };
  if (code === 'FailedOperation.InvoiceMismatch' || code === 'InvalidParameterValue.PriceOrVerificationParameterValueLimit') return { status: 'mismatch', message: '发票信息不一致，请核对票面信息' };
  if (code === 'FailedOperation.CountLimitError') return { status: 'limitExceeded', message: '查验次数已达限制，请次日再试' };
  if (code === 'ResourceNotFound.NotSupportCurrentInvoiceQuery') return { status: 'error', message: '当日发票暂不可查验，请稍后重试' };
  if (code === 'FailedOperation.UnOpenError') return { status: 'error', message: '腾讯云发票核验服务尚未开通' };
  if (code === 'ResourceUnavailable.InArrears' || code === 'ResourceUnavailable.ResourcePackageRunOut' || code === 'FailedOperation.ArrearsError') return { status: 'error', message: '腾讯云服务欠费或额度不足' };
  return { status: 'error', message: '查验服务暂不可用，请稍后重试或人工复核' };
}

export async function verifyWithTencent(invoice: Invoice, credentials: { secretId: string; secretKey: string; region: string }): Promise<Outcome> {
  if (!credentials.secretId || !credentials.secretKey) return { status: 'error', message: '腾讯云查验凭证尚未配置，请联系管理员' };
  let request: Request;
  try { request = buildTencentInvoiceRequest(invoice); } catch (error) { return { status: 'invalid', message: (error as Error).message }; }
  try {
    const client = new ocr.v20181119.Client({ credential: { secretId: credentials.secretId, secretKey: credentials.secretKey }, region: credentials.region, profile: { httpProfile: { endpoint: 'ocr.tencentcloudapi.com', reqTimeout: 15 } } });
    const response = await client.VatInvoiceVerifyNew(request);
    return interpretTencentInvoice(invoice, response);
  } catch (error) { return interpretTencentError(error); }
}
