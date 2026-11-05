import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSalaryModelGroups } from '../src/utils/salaryModel';

test('字段配置保留类型、用途和考勤接口', () => {
  const groups = buildSalaryModelGroups([{ name: '说明', type: 'text', category: 'info', interfaceSource: 'attendance' }], [{ name: '工时', type: 'number', category: 'info', interfaceSource: 'attendance' }]);
  assert.equal(groups.fixedFields[3].type, 'text');
  assert.equal(groups.fixedFields[3].interfaceSource, 'attendance');
  assert.equal(groups.extendedFields[0].interfaceSource, 'attendance');
  assert.throws(() => buildSalaryModelGroups([], [{ name: '说明', type: 'text', category: 'income' }]));
});
