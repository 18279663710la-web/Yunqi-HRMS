import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileWorkflowCases } from '../src/modules/approvals/workflowTestCases';

test('测试用例跟随当前字段增删并保留有效输入', () => {
  const fields = [
    { key: 'city', label: '城市', type: 'text' as const, required: true },
    { key: 'category', label: '类型', type: 'picker' as const, required: true, options: ['甲', '乙'] },
  ];
  const cases = [{ id: 'c1', name: '用例 1', values: { city: '上海', category: '旧选项', deleted: '删除' } }];
  assert.deepEqual(reconcileWorkflowCases(cases, fields)[0].values, { city: '上海', category: '' });
});

test('初始测试用例包含全部表单字段并选用合理默认值', () => {
  const cases = reconcileWorkflowCases([], [
    { key: 'type', label: '类型', type: 'picker', required: true, options: ['事假'] },
    { key: 'reason', label: '事由', type: 'text', required: true },
  ]);
  assert.equal(cases.length, 1);
  assert.equal(cases[0].values.type, '事假');
  assert.ok(cases[0].values.reason);
});

test('请假测试用例的时长由起止日期和时间计算', async () => {
  const { withDerivedTestValues } = await import('../src/modules/approvals/workflowTestCases');
  const values = { startDate: '2026-01-01', startClock: '09:00', endDate: '2026-01-02', endClock: '21:00', days: '99' };
  assert.equal(withDerivedTestValues('leave', values).days, '2');
  assert.equal(withDerivedTestValues('leave', { ...values, endDate: '2025-01-01' }).days, '');
  assert.equal(withDerivedTestValues('travel', values).days, '99');
});
