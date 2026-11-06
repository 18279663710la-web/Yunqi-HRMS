import assert from 'node:assert/strict';
import test from 'node:test';
import { applySalaryFieldChange } from '../src/modules/models-formulas/salary/salaryModel';
import type { SalaryComponentModel } from '../src/modules/hr/api';

const model: SalaryComponentModel = {
  version: 4,
  fixedFields: [
    { name: '姓名', type: 'text', required: true, role: 'name' },
    { name: '员工号', type: 'text', required: true, role: 'employeeNo' },
    { name: '职务', type: 'text', required: true, role: 'position' },
    { name: '基本工资', type: 'number', required: true, role: 'base', category: 'income' },
  ],
  extendedFields: [{ name: '出勤天', type: 'number', required: true, category: 'info' }],
  fieldOrder: ['姓名', '出勤天', '基本工资', '职务', '员工号'],
};

test('创建字段只影响指定组，已配置的交错顺序不丢失', () => {
  const next = applySalaryFieldChange(model, { action: 'create', group: 'fixed', field: { name: '津贴', type: 'number', required: true, category: 'income' } });
  assert.deepEqual(next.fixedFields.map(field => field.name), ['姓名', '员工号', '职务', '基本工资', '津贴']);
  assert.deepEqual(next.extendedFields, model.extendedFields);
  assert.deepEqual(next.fieldOrder, [...model.fieldOrder!, '津贴']);
  assert.equal(next.version, model.version);
});

test('编辑重命名保留显示位置，删除仅移除所选字段', () => {
  const renamed = applySalaryFieldChange(model, { action: 'edit', group: 'extended', name: '出勤天', field: { ...model.extendedFields[0], name: '考勤天数' } });
  assert.deepEqual(renamed.fieldOrder, ['姓名', '考勤天数', '基本工资', '职务', '员工号']);
  const deleted = applySalaryFieldChange(model, { action: 'delete', group: 'fixed', name: '基本工资' });
  assert.deepEqual(deleted.fieldOrder, ['姓名', '出勤天', '职务', '员工号']);
  assert.deepEqual(deleted.extendedFields, model.extendedFields);
});

test('身份字段只能编辑显示设置，禁止删除、改名或改变身份', () => {
  const updated = applySalaryFieldChange(model, { action: 'edit', group: 'fixed', name: '姓名', field: { ...model.fixedFields[0], name: '别名', type: 'number', displaySetting: 'output' } });
  assert.deepEqual(updated.fixedFields[0], { name: '姓名', type: 'text', required: true, role: 'name', displaySetting: 'output' });
  assert.throws(() => applySalaryFieldChange(model, { action: 'delete', group: 'fixed', name: '姓名' }), /不能删除/);
  assert.throws(() => applySalaryFieldChange(model, { action: 'edit', group: 'fixed', name: '不存在', field: model.fixedFields[3] }), /不存在/);
  assert.throws(() => applySalaryFieldChange(model, { action: 'edit', group: 'fixed', name: '基本工资', field: { ...model.fixedFields[3], name: '姓名' } }), /固定字段/);
  assert.throws(() => applySalaryFieldChange(model, { action: 'create', group: 'extended', field: model.fixedFields[3] }), /重复/);
});
