import test from 'node:test';
import assert from 'node:assert/strict';
import { formTemplateSchema, validateAnswers } from '../src/domains/onboarding/onboardingForm';

test('模板字段校验类型、长度及必填，拒绝未知字段', () => {
  const fields = formTemplateSchema.parse([{ name: '联系地址', type: 'text', required: true, maxLength: 5 }, { name: '工龄', type: 'number', required: false, min: 0, max: 50 }]);
  assert.deepEqual(validateAnswers(fields, { 联系地址: '上海', 工龄: 2 }), { 联系地址: '上海', 工龄: 2 });
  assert.throws(() => validateAnswers(fields, { 联系地址: '' }));
  assert.throws(() => validateAnswers(fields, { 联系地址: '超过五个字的地址' }));
  assert.throws(() => validateAnswers(fields, { 联系地址: '上海', 工龄: -1 }));
  assert.throws(() => validateAnswers(fields, { 联系地址: '上海', 额外字段: 'x' }));
  assert.throws(() => formTemplateSchema.parse([{ name: '地址', type: 'text', required: true }, { name: '地址', type: 'text', required: false }]));
});

test('单选字段只接受配置的选项并校验必填与重复选项', () => {
  const fields = formTemplateSchema.parse([{ name: '性别', type: 'select', required: true, options: ['男', '女'] }]);
  assert.deepEqual(validateAnswers(fields, { 性别: '男' }), { 性别: '男' });
  assert.deepEqual(validateAnswers(fields, { 性别: ' 女 ' }), { 性别: '女' });
  assert.throws(() => validateAnswers(fields, { 性别: '未知' }), /选项无效/);
  assert.throws(() => validateAnswers(fields, { 性别: '' }), /请填写性别/);
  assert.throws(() => formTemplateSchema.parse([{ name: '性别', type: 'select', required: true, options: ['男', '男'] }]), /选项不能重复/);
  assert.throws(() => formTemplateSchema.parse([{ name: '性别', type: 'select', required: true, options: [] }]));
  assert.throws(() => formTemplateSchema.parse([{ name: '性别', type: 'select', required: true, options: [''] }]));
});
