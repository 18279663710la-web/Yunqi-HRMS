import assert from 'node:assert/strict';
import test from 'node:test';
import { getInvoiceCheckState } from '../../miniprogram/utils/invoice-precheck';

const invoice = { invoiceNumber: '12345678901234567890', invoiceCode: '' };
const clear = { id: 'a', status: 'done', checkState: 'clear', result: invoice };

test('发票必须完成识别、查重和验真，同一单据不能添加重复票据', () => {
  assert.equal(getInvoiceCheckState([], false).ready, false);
  assert.equal(getInvoiceCheckState([clear], false).ready, true);
  assert.equal(getInvoiceCheckState([{ ...clear, checkState: 'checking' }], false).ready, false);
  assert.equal(getInvoiceCheckState([{ ...clear, checkState: 'verifying' }], false).ready, false);
  assert.equal(getInvoiceCheckState([{ ...clear, checkState: 'blocked' }], false).ready, false);
  assert.equal(getInvoiceCheckState([{ ...clear, checkState: 'error' }], false).ready, false);
  assert.equal(getInvoiceCheckState([{ ...clear, status: 'failed' }], false).ready, false);
  assert.equal(getInvoiceCheckState([clear, { ...clear, id: 'b', result: { ...invoice, invoiceCode: '044031900111' } }], false).ready, false);
  assert.equal(getInvoiceCheckState([clear], true).ready, false);
});
