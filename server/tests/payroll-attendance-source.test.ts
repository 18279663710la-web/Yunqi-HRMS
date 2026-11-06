import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeModelInput, normalizeStoredModel } from '../src/domains/payroll/salaryModelService';

test('考勤数据项目在固定和扩展字段保存并读取，限制数字及仅记录', () => {
  const result = normalizeModelInput(
    [{ name: '出勤天数', type: 'number', category: 'info', interfaceSource: 'attendance', attendanceMetric: 'presentDays' }],
    [{ name: '加班时长', type: 'number', category: 'info', interfaceSource: 'attendance', attendanceMetric: 'overtimeHours' }],
  );
  const saved = normalizeStoredModel({ version: 1, ...result });
  assert.equal(saved.fixedFields.find(field => field.name === '出勤天数')?.attendanceMetric, 'presentDays');
  assert.equal(saved.extendedFields[0].attendanceMetric, 'overtimeHours');
  assert.throws(() => normalizeModelInput([], [{ name: '加班费', type: 'number', category: 'income', interfaceSource: 'attendance', attendanceMetric: 'overtimeHours' }]));
  assert.throws(() => normalizeModelInput([], [{ name: '说明', type: 'text', category: 'info', interfaceSource: 'attendance', attendanceMetric: 'presentDays' }]));
  assert.throws(() => normalizeModelInput([], [{ name: '无效', type: 'number', category: 'info', interfaceSource: 'attendance', attendanceMetric: 'unknown' }]));
  assert.throws(() => normalizeModelInput([], [{ name: '错误来源', type: 'number', category: 'info', attendanceMetric: 'presentDays' }]));
});

test('旧的未选择考勤项目的字段仍可读取和保存', () => {
  const model = normalizeStoredModel({ extendedFields: [{ name: '备注', type: 'text', category: 'info', interfaceSource: 'attendance' }] });
  assert.equal(model.extendedFields[0].interfaceSource, 'attendance');
  assert.deepEqual(normalizeModelInput(model.fixedFields, model.extendedFields).extendedFields, model.extendedFields);
});

test('加班费是唯一的数字收入字段，保存和读取时保留计算来源', () => {
  const field = { name: '加班费', type: 'number', category: 'income', interfaceSource: 'attendance', attendanceMetric: 'overtimePay' };
  const model = normalizeModelInput([], [field]);
  assert.equal(normalizeStoredModel({ version: 1, ...model }).extendedFields[0].attendanceMetric, 'overtimePay');
  assert.throws(() => normalizeModelInput([], [{ ...field, category: 'info' }]));
  assert.throws(() => normalizeModelInput([field], [{ ...field, name: '重复加班费' }]));
});

test('规则与数据项按组合保存，旧加班费字段可继续读取', () => {
  const field = { name: '加班绩效', type: 'number', category: 'income', interfaceSource: 'attendance', attendanceMetric: 'overtimeHours', calculationRule: 'overtime' };
  const result = normalizeModelInput([], [field]);
  assert.equal(normalizeStoredModel({ version: 1, ...result }).extendedFields[0].calculationRule, 'overtime');
  assert.throws(() => normalizeModelInput([], [{ ...field, attendanceMetric: 'presentDays' }]));
  assert.throws(() => normalizeModelInput([], [{ ...field, calculationRule: 'direct' }]));
  assert.throws(() => normalizeModelInput([], [field, { ...field, name: '重复' }]));
});
