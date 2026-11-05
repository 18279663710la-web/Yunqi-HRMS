import assert from 'node:assert/strict';
import test from 'node:test';
import { crc16UmtsHex, parseInvoiceQR, formatInvoiceCrc } from '../../miniprogram/services/invoices/ocr';

test('CRC-16 使用标准检验向量并校验数电票完整的分隔符', () => {
  assert.equal(crc16UmtsHex('123456789'), 'FEE8');
  const parsed = parseInvoiceQR('01,32,,12345678901234567890,100.00,20261028,,9c1c');
  assert.equal(parsed.crc, '9C1C');
  assert.equal(parsed.crcCalc, '9C1C');
  assert.equal(parsed.crcVerified, true);
  assert.equal(formatInvoiceCrc(parsed), '9C1C（自检通过）');
});

test('内容更改后显示不一致，未经确认的格式不作错误判断', () => {
  const changed = parseInvoiceQR('01,32,,12345678901234567891,100.00,20261028,,9C1C');
  assert.equal(changed.crcCalc, '0867');
  assert.equal(changed.crcVerified, false);
  assert.match(formatInvoiceCrc(changed), /自检未通过/);
  for (const raw of [
    '01,10,044031900111,08812453,386.00,20261008,07182231004588120000,ABCD',
    '01,32,,12345678901234567890,100.00,20261028,,9C1C,',
  ]) {
    const unknown = parseInvoiceQR(raw);
    assert.equal(unknown.crcVerified, undefined);
    assert.equal(unknown.crcCalc, undefined);
    assert.match(formatInvoiceCrc(unknown), /未验证/);
  }
});

test('缺少 CRC 时不会把校验码或日期当作 CRC', () => {
  const sevenFields = parseInvoiceQR('01,10,044031900111,08812453,386.00,20261008,1234');
  assert.equal(sevenFields.crc, '');
  assert.equal(sevenFields.crcVerified, undefined);
  assert.equal(formatInvoiceCrc(sevenFields), '—');
});
