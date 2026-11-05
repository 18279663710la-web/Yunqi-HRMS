import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeStoredModel, reconcileSalaryFieldOrder, validateSalaryFieldOrder } from '../src/domains/payroll/salaryModelService';

const groups = { fixedFields: [{ name: '姓名' }, { name: '员工号' }, { name: '职务' }, { name: '基本工资' }], extendedFields: [{ name: '出勤天' }] };

test('历史模型不强制写入顺序，已有顺序读取时补齐新增字段并剔除失效项', () => {
  assert.equal(normalizeStoredModel({ fixedFields: ['基本工资'], extendedFields: ['出勤天'] }).fieldOrder, undefined);
  const model = normalizeStoredModel({ ...groups, fieldOrder: ['出勤天', '姓名', '已删除', '姓名'] });
  assert.deepEqual(model.fieldOrder, ['出勤天', '姓名', '员工号', '职务', '基本工资']);
  assert.deepEqual(reconcileSalaryFieldOrder(['出勤天', '姓名', '已删除'], ['姓名', '员工号', '职务', '基本工资', '出勤天']), ['出勤天', '姓名', '员工号', '职务', '基本工资']);
});

test('保存顺序必须完整且无重复，支持固定、扩展和身份字段交错', () => {
  const names = ['姓名', '员工号', '职务', '基本工资', '出勤天'];
  const order = ['出勤天', '基本工资', '职务', '姓名', '员工号'];
  assert.deepEqual(validateSalaryFieldOrder(order, names), order);
  assert.throws(() => validateSalaryFieldOrder(['姓名', '姓名'], names));
  assert.throws(() => validateSalaryFieldOrder([...names, '未知'], names));
});
