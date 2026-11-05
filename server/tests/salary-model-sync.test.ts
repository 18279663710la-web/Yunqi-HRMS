import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSalaryValues, normalizeStoredModel, synchronizeSalaryRecord } from '../src/domains/payroll/salaryModelService';

test('模型补齐不可更改的姓名、员工号和职务，其他字段可为字符串', () => {
  const model = normalizeStoredModel({ fixedFields: [{ name: '薪资', type: 'text' }], extendedFields: [] });
  assert.deepEqual(model.fixedFields.slice(0, 3), [
    { name: '姓名', type: 'text', required: true, role: 'name' },
    { name: '员工号', type: 'text', required: true, role: 'employeeNo' },
    { name: '职务', type: 'text', required: true, role: 'position' },
  ]);
  assert.equal(model.fixedFields[3].type, 'text');
});

test('模型更新按名称保留、删除和新增字段，并同步工资镜像', () => {
  const oldModel = normalizeStoredModel({ fixedFields: ['基础薪资', '固定补贴', '绩效薪资'], extendedFields: [] });
  const nextModel = normalizeStoredModel({ version: 2, fixedFields: ['基本工资', '绩效薪资', '餐补'], extendedFields: [] });
  const record = { effectiveDate: '2026-01-01', values: { 基础薪资: 6000, 固定补贴: 500, 绩效薪资: 1000 }, base: 6000, allowance: 500, performance: 1000 };
  const result = synchronizeSalaryRecord(record, oldModel, nextModel);
  assert.deepEqual(result.values, { 基本工资: 0, 绩效薪资: 1000, 餐补: 0 });
  assert.equal(result.base, 0);
  assert.equal(result.allowance, null);
  assert.equal(result.performance, 1000);
  assert.equal(result.effectiveDate, record.effectiveDate);
  assert.equal(result.modelVersion, 2);
});

test('旧定薪镜像仍按原模型字段映射，新字段默认为零', () => {
  const oldModel = normalizeStoredModel({ fixedFields: ['基础薪资'], extendedFields: [] });
  const nextModel = normalizeStoredModel({ version: 2, fixedFields: ['基础薪资', '餐补'], extendedFields: [] });
  const result = synchronizeSalaryRecord({ base: 1234 }, oldModel, nextModel);
  assert.deepEqual(result.values, { 基础薪资: 1234, 餐补: 0 });
  assert.deepEqual(buildSalaryValues({}, nextModel), { 基础薪资: 0, 餐补: 0 });
});
