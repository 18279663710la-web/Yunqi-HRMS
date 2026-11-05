import assert from 'node:assert/strict';
import test from 'node:test';
import { applySalaryFieldChange, buildSalaryModelGroups } from '../src/modules/models-formulas/salary/salaryModel';

test('编辑其他字段时保留考勤字段的数据项目，切换为无后移除项目', () => {
  const groups = buildSalaryModelGroups([], [{ name: '出勤天数', type: 'number', required: true, category: 'info', interfaceSource: 'attendance', attendanceMetric: 'presentDays' }]);
  const model = { version: 1, ...groups };
  const added = applySalaryFieldChange(model, { action: 'create', group: 'extended', field: { name: '备注', type: 'text', required: false, category: 'info' } });
  assert.equal(added.extendedFields[0].attendanceMetric, 'presentDays');
  const changed = applySalaryFieldChange(model, { action: 'edit', group: 'extended', name: '出勤天数', field: { name: '出勤天数', type: 'number', required: true, category: 'info', interfaceSource: 'none' } });
  assert.equal(changed.extendedFields[0].attendanceMetric, undefined);
});
