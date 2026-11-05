import assert from 'node:assert/strict';
import test from 'node:test';
import { answerChanges, answersEqual, formTemplateSchema } from '../src/domains/onboarding/onboardingForm';

const fields = formTemplateSchema.parse([
  { name: '姓名', type: 'text', required: false, maxLength: 10 },
  { name: '教育经历', type: 'table', required: false, children: [
    { name: '学校', type: 'text', required: true, maxLength: 20 },
    { name: '年份', type: 'number', required: false, min: 1900 },
  ] },
]);

test('申请修改差异记录普通字段、表格单元格和新增行', () => {
  const changes = answerChanges(fields,
    { 姓名: '张三', 教育经历: [{ 学校: '大学', 年份: 2020 }] },
    { 姓名: '李四', 教育经历: [{ 学校: '学院', 年份: 2020 }, { 学校: '研究生院' }] });
  assert.deepEqual(changes, [
    { kind: 'field', field: '姓名', before: '张三', after: '李四' },
    { kind: 'cell', field: '教育经历', row: 1, child: '学校', before: '大学', after: '学院' },
    { kind: 'addRow', field: '教育经历', row: 2, after: { 学校: '研究生院' } },
  ]);
});

test('申请修改差异记录删除行和空值变化', () => {
  const changes = answerChanges(fields,
    { 教育经历: [{ 学校: '大学' }, { 学校: '学院' }] },
    { 姓名: '张三', 教育经历: [{ 学校: '大学' }] });
  assert.deepEqual(changes, [
    { kind: 'field', field: '姓名', after: '张三' },
    { kind: 'removeRow', field: '教育经历', row: 2, before: { 学校: '学院' } },
  ]);
});

test('相同答案不产生差异', () => {
  const values = { 姓名: '张三', 教育经历: [{ 学校: '大学', 年份: 2020 }] };
  assert.deepEqual(answerChanges(fields, values, structuredClone(values)), []);
  assert.equal(answersEqual(values, structuredClone(values)), true);
  assert.equal(answersEqual(values, { ...values, 姓名: '李四' }), false);
});
