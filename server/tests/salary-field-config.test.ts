import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeModelInput, normalizeStoredModel, synchronizeSalaryRecord, validateSalaryValues } from '../src/domains/payroll/salaryModelService';
import { fixedSalarySnapshot, calculateExtendedSalary } from '../src/domains/payroll/payrollModelCalculation';

test('保存数字、字符串、字段用途及考勤接口配置', () => {
  const input = normalizeModelInput(
    [{ name: '基本工资', type: 'number', category: 'income', interfaceSource: 'none' }, { name: '岗位说明', type: 'text', category: 'info', interfaceSource: 'attendance' }],
    [{ name: '考勤备注', type: 'text', category: 'info', interfaceSource: 'attendance' }, { name: '罚款', type: 'number', category: 'deduction', interfaceSource: 'none' }]
  );
  const model = normalizeStoredModel({ version: 2, ...input });
  assert.equal(model.fixedFields[4].type, 'text');
  assert.equal(model.fixedFields[4].interfaceSource, 'attendance');
  assert.equal(model.extendedFields[0].type, 'text');
  assert.equal(model.extendedFields[0].interfaceSource, 'attendance');
  assert.throws(() => normalizeModelInput([], [{ name: '文字收入', type: 'text', category: 'income' }]));
  assert.throws(() => normalizeModelInput([], [{ name: '其他', type: 'number', interfaceSource: 'unknown' }]));
});

test('同名字段变更类型时仅允许无损转换', () => {
  const old = normalizeStoredModel({ fixedFields: [{ name: '字段', type: 'number' }] });
  const text = normalizeStoredModel({ fixedFields: [{ name: '字段', type: 'text' }] });
  assert.deepEqual(synchronizeSalaryRecord({ values: { 字段: 123.45 } }, old, text).values, { 字段: '123.45' });
  assert.deepEqual(synchronizeSalaryRecord({ values: { 字段: '123.45' } }, text, old).values, { 字段: 123.45 });
  assert.throws(() => synchronizeSalaryRecord({ values: { 字段: '001' } }, text, old));
  assert.throws(() => synchronizeSalaryRecord({ values: { 字段: '不适用' } }, text, old));
  assert.deepEqual(validateSalaryValues({ 字段: '说明' }, text).values, { 字段: '说明' });
});

test('按字段用途计算固定薪资并保留字符串，扩展字段默认值按类型设置', () => {
  const model = normalizeStoredModel({ fixedFields: [{ name: '工资', type: 'number', category: 'income' }, { name: '固定扣款', type: 'number', category: 'deduction' }, { name: '备注', type: 'text', category: 'info' }], extendedFields: [{ name: '考勤说明', type: 'text', category: 'info' }, { name: '奖励', type: 'number', category: 'income' }] });
  const snapshot = fixedSalarySnapshot({ values: { 工资: 1000, 固定扣款: 50, 备注: '正常' } }, model);
  assert.equal(snapshot.fixedTotal, 1000);
  assert.equal(snapshot.fixed.find(field => field.name === '备注')?.value, '正常');
  assert.equal(snapshot.extended[0].value, '');
  assert.deepEqual(calculateExtendedSalary(snapshot), { gross: 1000, deductions: 50, net: 950 });
});
