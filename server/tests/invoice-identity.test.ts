import assert from 'node:assert/strict';
import test from 'node:test';
import { invoiceKey as serverKey } from '../src/shared/utils/invoice';
import { invoiceKey as miniKey } from '../../miniprogram/utils/invoice-identity';

for (const [name, key] of [['服务端', serverKey], ['小程序', miniKey]] as const) {
  test(`${name}区分数电票和传统发票并统一格式`, () => {
    assert.equal(key({ invoiceNumber: ' 1234 5678 9012 3456 7890 ', invoiceCode: '' }), '12345678901234567890');
    assert.equal(key({ invoiceNumber: '12345678901234567890', invoiceCode: '123456789012' }), '12345678901234567890');
    assert.equal(key({ invoiceCode: '0440 3190 0111', invoiceNumber: '0881-2453' }), '044031900111-08812453');
    assert.notEqual(key({ invoiceCode: '044031900111', invoiceNumber: '08812453' }), key({ invoiceCode: '044031900112', invoiceNumber: '08812453' }));
  });
  test(`${name}拒绝无法唯一识别的号码`, () => {
    assert.equal(key({ invoiceNumber: '' }), '');
    assert.equal(key({ invoiceNumber: '08812453', invoiceCode: '' }), '');
    assert.equal(key({ invoiceNumber: 'ABC', invoiceCode: '044031900111' }), '');
    assert.equal(key({ invoiceNumber: '08812453', invoiceCode: '123' }), '');
  });
}
