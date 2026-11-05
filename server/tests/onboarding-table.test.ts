import test from 'node:test';
import assert from 'node:assert/strict';
import { formTemplateSchema, validateAnswers } from '../src/domains/onboarding/onboardingForm';

test('表格字段支持多行及子字段校验，拒绝错误结构和越权字段', () => {
  const fields = formTemplateSchema.parse([{ name: '教育经历', type: 'table', required: true, children: [
    { name: '学校', type: 'text', required: true, maxLength: 10 },
    { name: '年份', type: 'number', required: false, min: 1900, max: 2100 },
    { name: '结束日期', type: 'date', required: false },
  ] }]);
  assert.deepEqual(validateAnswers(fields, { 教育经历: [{ 学校: '大学', 年份: 2020 }, { 学校: '学院', 结束日期: '2025-06-01' }] }), { 教育经历: [{ 学校: '大学', 年份: 2020 }, { 学校: '学院', 结束日期: '2025-06-01' }] });
  assert.throws(() => validateAnswers(fields, { 教育经历: [] }));
  assert.throws(() => validateAnswers(fields, { 教育经历: [{ 学校: '' }] }));
  assert.throws(() => validateAnswers(fields, { 教育经历: [{ 学校: '大学', 年份: 1800 }] }));
  assert.throws(() => validateAnswers(fields, { 教育经历: [{ 学校: '大学', 未知: 'x' }] }));
  assert.throws(() => formTemplateSchema.parse([{ name: '教育经历', type: 'table', required: false, children: [] }]));
  assert.throws(() => formTemplateSchema.parse([{ name: '教育经历', type: 'table', required: false, children: [{ name: '学校', type: 'text', required: true }, { name: '学校', type: 'text', required: true }] }]));
});

test('表格子字段支持单选类型和选项校验', () => {
  const fields = formTemplateSchema.parse([{ name: '工作经历', type: 'table', required: true, children: [
    { name: '性质', type: 'select', required: true, options: ['全职', '实习'] },
  ] }]);
  assert.deepEqual(validateAnswers(fields, { 工作经历: [{ 性质: '实习' }] }), { 工作经历: [{ 性质: '实习' }] });
  assert.throws(() => validateAnswers(fields, { 工作经历: [{ 性质: '兼职' }] }), /选项无效/);
  assert.throws(() => validateAnswers(fields, { 工作经历: [{}] }), /请填写性质/);
});
