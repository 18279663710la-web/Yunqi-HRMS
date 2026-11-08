import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeExpenseOptions } from '../src/modules/approvals/expenseFormOptions';

test('单选选项去除首尾空格，保留顺序和内容', () => {
  assert.deepEqual(normalizeExpenseOptions([' 内部 ', '客户']), ['内部', '客户']);
});

test('单选选项不能留空、重复或超出数量及长度限制', () => {
  assert.equal(normalizeExpenseOptions([]), null);
  assert.equal(normalizeExpenseOptions(['内部', '  ']), null);
  assert.equal(normalizeExpenseOptions(['内部', ' 内部 ']), null);
  assert.equal(normalizeExpenseOptions(Array.from({ length: 51 }, (_, i) => `选项${i}`)), null);
  assert.equal(normalizeExpenseOptions(['字'.repeat(101)]), null);
});
