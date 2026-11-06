import assert from 'node:assert/strict';
import test from 'node:test';
import { moveSalaryField, orderedSalaryFields } from '../src/modules/models-formulas/salary/salaryModel';
import type { SalaryComponentModel } from '../src/api/hr';

const model: SalaryComponentModel = {
  version: 1,
  fixedFields: [{ name: '姓名', type: 'text', required: true, role: 'name' }, { name: '工资', type: 'number', required: true }],
  extendedFields: [{ name: '出勤', type: 'number', required: true }],
};

test('兼容旧模型与跨组排序，并保持固定、扩展字段本身不变', () => {
  assert.deepEqual(orderedSalaryFields(model).map(field => field.name), ['姓名', '工资', '出勤']);
  assert.deepEqual(orderedSalaryFields({ ...model, fieldOrder: ['出勤', '姓名', '工资'] }).map(field => field.name), ['出勤', '姓名', '工资']);
  assert.deepEqual(model.fixedFields.map(field => field.name), ['姓名', '工资']);
});

test('按左右位置移动字段，不影响其余字段相对顺序', () => {
  assert.deepEqual(moveSalaryField(['姓名', '工资', '出勤'], '出勤', '姓名', 'before'), ['出勤', '姓名', '工资']);
  assert.deepEqual(moveSalaryField(['姓名', '工资', '出勤'], '姓名', '出勤', 'after'), ['工资', '出勤', '姓名']);
  assert.deepEqual(moveSalaryField(['姓名', '工资'], '工资', '未知', 'before'), ['姓名', '工资']);
});
