import assert from 'node:assert/strict';
import test from 'node:test';
import { formatMoney } from '../src/domains/u9/money';

test('U9 金额按币种精度显示，不使用浮点数', () => {
  assert.equal(formatMoney('999999999999999999.995', 2), '1000000000000000000.00');
  assert.equal(formatMoney('-1.005', 2), '-1.01');
  assert.equal(formatMoney('12.345678901', 9), '12.345678901');
  assert.equal(formatMoney('12.9', 0), '13');
  assert.equal(formatMoney(null, 2), '-');
});
