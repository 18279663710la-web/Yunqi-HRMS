import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInlinePayrollUpdate, previewInlinePayrollTotals, parseManualDeduction } from '../src/modules/hr/payroll/payrollInlineEdit';
import type { PayrollModelSnapshot } from '../src/modules/hr/api';

const snapshot: PayrollModelSnapshot = { version: 1, revision: 3, fixedTotal: 1000, manualDeduction: 7, fixed: [{ name: '基本工资', value: 1000, category: 'income' }], extended: [
  { name: '补贴', value: 0, category: 'income' },
  { name: '社保', value: 5, category: 'deduction' },
  { name: '备注', value: '', type: 'text', category: 'info' },
  { name: '出勤天数', value: 20, category: 'info', attendanceMetric: 'presentDays', interfaceSource: 'attendance' },
] };

test('单元格更新保留其他字段和版本，数字与文本按快照类型保存', () => {
  const update = buildInlinePayrollUpdate(snapshot, '补贴', '12.35');
  assert.equal(update.revision, 3);
  assert.deepEqual(update.values.map(item => item.value), [12.35, 5, '', 20]);
  assert.equal(snapshot.extended[0].value, 0);
  assert.equal(buildInlinePayrollUpdate(snapshot, '备注', '夜班').values[2].value, '夜班');
  assert.equal(buildInlinePayrollUpdate(snapshot, '备注', '').values[2].value, '');
});

test('拒绝修改固定字段、考勤字段及无效金额', () => {
  for (const value of ['', '-1', '1.234', '10000000000', 'abc']) assert.throws(() => buildInlinePayrollUpdate(snapshot, '补贴', value));
  assert.throws(() => buildInlinePayrollUpdate(snapshot, '出勤天数', '10'), /不能手工修改/);
  assert.throws(() => buildInlinePayrollUpdate(snapshot, '基本工资', '10'), /扩展字段/);
  assert.throws(() => buildInlinePayrollUpdate(snapshot, '备注', '字'.repeat(201)), /200/);
});

test('输入时按字段用途预览应发、扣除和实发，空值不预览', () => {
  assert.deepEqual(previewInlinePayrollTotals(snapshot, '社保', '300'), { gross: 700, deductions: 7, net: 693 });
  assert.deepEqual(previewInlinePayrollTotals(snapshot, '补贴', '12.35'), { gross: 1007.35, deductions: 7, net: 1000.35 });
  assert.deepEqual(previewInlinePayrollTotals(snapshot, '备注', '夜班'), { gross: 995, deductions: 7, net: 988 });
  assert.deepEqual(previewInlinePayrollTotals(snapshot, '', '300', true), { gross: 995, deductions: 300, net: 695 });
  assert.equal(previewInlinePayrollTotals(snapshot, '社保', ''), undefined);
  assert.equal(snapshot.extended[1].value, 5);
});

test('手工扣除金额按非负金额及分精度校验', () => {
  assert.equal(parseManualDeduction('350.25'), 350.25);
  assert.equal(parseManualDeduction('0'), 0);
  for (const value of ['', '-1', '1.234', '10000000000', 'abc']) assert.throws(() => parseManualDeduction(value));
});
