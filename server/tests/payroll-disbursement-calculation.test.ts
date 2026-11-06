import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateDisbursementNet } from '../src/domains/payroll/payrollDisbursementCalculation';

test('实发以应发为基础，加收入、减扣款，仅记录不计入', () => {
  assert.equal(calculateDisbursementNet(4400, [
    { category: 'income', value: 100.25 },
    { category: 'deduction', value: 30.10 },
    { category: 'info', value: 999 },
  ]), 4470.15);
});

test('没有补充项时实发等于应发，金额按分计算', () => {
  assert.equal(calculateDisbursementNet(3700, []), 3700);
  assert.equal(calculateDisbursementNet(0.1, [{ category: 'income', value: 0.2 }]), 0.3);
});
