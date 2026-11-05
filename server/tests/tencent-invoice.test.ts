import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTencentInvoiceRequest, interpretTencentInvoice, interpretTencentError, ensureInvoicesVerified, verifyWithTencent } from '../src/domains/invoices/tencentInvoiceVerifier';
import type { Invoice } from '../src/shared/types/models';

const digital = { id: 'test', invoiceType: '增值税电子发票', invoiceCode: '', invoiceNumber: '12345678901234567890', invoiceDate: '2026-10-05', totalAmount: 343, amount: 343, taxAmount: 0 } satisfies Invoice;

test('数电发票使用价税合计和 20 位号码，不能将二维码类型 32 当成腾讯票种', () => {
  assert.deepEqual(buildTencentInvoiceRequest(digital), { InvoiceNo: digital.invoiceNumber, InvoiceDate: '2026-10-05', Amount: '343.00', EnableTodayInvoice: true });
});

test('缺少必填信息和不明确的传统发票不得请求查验', () => {
  assert.throws(() => buildTencentInvoiceRequest({ ...digital, totalAmount: 0 }), /价税合计/);
  assert.throws(() => buildTencentInvoiceRequest({ ...digital, invoiceNumber: '12345678', invoiceCode: '123456789012' }), /票种/);
});

test('未配置密钥时明确返回查验失败', async () => {
  const result = await verifyWithTencent(digital, { secretId: '', secretKey: '', region: 'ap-guangzhou' });
  assert.equal(result.status, 'error');
  assert.match(result.message, /凭证尚未配置/);
});

test('只有明确正常且号码一致时才判定查验通过', () => {
  const invoice = { Number: digital.invoiceNumber, IsAbandoned: 'N', RedLetterInvoiceMark: false, AmountWithTax: '343.00' };
  assert.equal(interpretTencentInvoice(digital, { Invoice: invoice }).status, 'valid');
  assert.equal(interpretTencentInvoice(digital, { Invoice: { ...invoice, IsAbandoned: 'HP' } }).status, 'abnormal');
  assert.equal(interpretTencentInvoice(digital, { Invoice: { ...invoice, RedLetterInvoiceMark: true } }).status, 'abnormal');
  assert.equal(interpretTencentInvoice(digital, { Invoice: { ...invoice, IsAbandoned: '' } }).status, 'error');
  assert.equal(interpretTencentInvoice(digital, { Invoice: { ...invoice, Number: '99999999999999999999' } }).status, 'mismatch');
  assert.equal(interpretTencentInvoice(digital, { Invoice: { ...invoice, AmountWithTax: '999.00' } }).status, 'mismatch');
});

test('错误码区分查无此票、信息不一致、限制和服务异常', () => {
  assert.equal(interpretTencentError({ code: 'ResourceNotFound.NoInvoice' }).status, 'notFound');
  assert.equal(interpretTencentError({ code: 'FailedOperation.InvoiceMismatch' }).status, 'mismatch');
  assert.equal(interpretTencentError({ code: 'FailedOperation.CountLimitError' }).status, 'limitExceeded');
  assert.equal(interpretTencentError({ code: 'ResourceUnavailable.TaxNetworkError' }).status, 'error');
});

test('报销单中每张发票都要通过真实查验，任何异常或模拟结果均不能通过', async () => {
  await assert.doesNotReject(() => ensureInvoicesVerified([digital], async () => ({ status: 'valid', mock: false, message: '通过' })));
  await assert.rejects(() => ensureInvoicesVerified([digital], async () => ({ status: 'valid', mock: true, message: '模拟结果' })), /模拟结果/);
  await assert.rejects(() => ensureInvoicesVerified([digital], async () => ({ status: 'notFound', mock: false, message: '查无此票' })), /查无此票/);
});
