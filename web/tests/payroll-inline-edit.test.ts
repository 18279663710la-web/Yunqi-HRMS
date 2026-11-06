import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInlinePayrollUpdate } from '../src/modules/hr/payroll/payrollInlineEdit';
import type { PayrollModelSnapshot } from '../src/modules/hr/api';

const snapshot: PayrollModelSnapshot = { version: 1, revision: 3, fixedTotal: 1000, fixed: [{ name: '基本工资', value: 1000, category: 'income' }], extended: [
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
