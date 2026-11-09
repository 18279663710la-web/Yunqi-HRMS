import assert from 'node:assert/strict';
import test from 'node:test';
import { validateWorkflowTestValues, type WorkflowTestField } from '../src/domains/approvals/customWorkflowTestFields';

const fields: WorkflowTestField[] = [
  { key: 'leaveType', label: '请假类型', type: 'picker', required: true, options: ['事假', '病假'] },
  { key: 'project', label: '项目', type: 'text', required: true },
  { key: 'amount', label: '金额', type: 'number', required: false },
];

test('测试用例必须满足当前表单的必填项与选项', () => {
  assert.match(validateWorkflowTestValues(fields, { leaveType: '年假', project: '' }) ?? '', /请假类型|项目/);
  assert.match(validateWorkflowTestValues(fields, { leaveType: '事假', project: '客户', amount: 'abc' }) ?? '', /金额/);
  assert.equal(validateWorkflowTestValues(fields, { leaveType: '事假', project: '客户', amount: '2.5' }), null);
});

test('请假时长与起止时间不一致时，测试用例无效', async () => {
  const { validateWorkflowTestCase } = await import('../src/domains/approvals/customWorkflowTestFields');
  const leaveFields: WorkflowTestField[] = [];
  const values = { startDate: '2026-01-01', startClock: '09:00', endDate: '2026-01-01', endClock: '18:00', days: '99' };
  assert.match(validateWorkflowTestCase('leave', leaveFields, values) ?? '', /时长/);
  assert.equal(validateWorkflowTestCase('leave', leaveFields, { ...values, days: '1' }), null);
});

test('报销测试用例缺少发票时不能视为有效', async () => {
  const { validateWorkflowTestCase } = await import('../src/domains/approvals/customWorkflowTestFields');
  assert.match(validateWorkflowTestCase('expense', [], { __invoice: '未提供' }) ?? '', /发票/);
  assert.equal(validateWorkflowTestCase('expense', [], { __invoice: '已提供' }), null);
});

test('出差日期与加班时间不能倒置', async () => {
  const { validateWorkflowTestCase } = await import('../src/domains/approvals/customWorkflowTestFields');
  assert.match(validateWorkflowTestCase('travel', [], { startDate: '2026-01-02', endDate: '2026-01-01' }) ?? '', /日期/);
  assert.match(validateWorkflowTestCase('overtime', [], { startTime: '18:00', endTime: '17:00' }) ?? '', /时间/);
});

test('继承的对象属性不能冒充测试用例字段值', () => {
  const fields: WorkflowTestField[] = [{ key: 'constructor', label: '自定义字段', type: 'text', required: true }];
  assert.match(validateWorkflowTestValues(fields, {}) ?? '', /自定义字段/);
});

test('测试用例遵循表单文字长度限制', () => {
  const fields: WorkflowTestField[] = [{ key: 'reason', label: '事由', type: 'text', required: true, maxlength: 3 }];
  assert.match(validateWorkflowTestValues(fields, { reason: '四个文字' }) ?? '', /事由/);
  assert.equal(validateWorkflowTestValues(fields, { reason: '三个字' }), null);
});
