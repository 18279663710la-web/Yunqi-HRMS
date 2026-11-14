import assert from 'node:assert/strict';
import test from 'node:test';

test('报销金额分支使用发票价税合计，签名地址过期后失效', async () => {
  const { expenseBranchAmount } = await import('../src/domains/approvals/approvalService');
  const { planWorkflowExecution } = await import('../src/domains/approvals/customWorkflowExecutionPlan');
  const { signExpenseFile, verifyExpenseFileSignature } = await import('../src/domains/approvals/expenseFileAccess');
  const graph = {
    version: 1,
    formFields: [],
    nodes: [
      { id: 's', kind: 'start' as const, position: { x: 0, y: 0 } },
      { id: 'b', kind: 'branch' as const, position: { x: 1, y: 0 } },
      { id: 'low', kind: 'approver' as const, position: { x: 2, y: 0 }, config: { approverIds: ['U001'] } },
      { id: 'high', kind: 'approver' as const, position: { x: 2, y: 1 }, config: { approverIds: ['U002'] } },
      { id: 'e', kind: 'end' as const, position: { x: 3, y: 0 }, config: { outcome: 'approved' as const } },
    ],
    edges: [
      { id: 'sb', source: 's', target: 'b' },
      { id: 'low', source: 'b', target: 'low', conditions: [{ field: 'amount', operator: 'lt' as const, value: '100' }] },
      { id: 'high', source: 'b', target: 'high', conditions: [{ field: 'amount', operator: 'gte' as const, value: '100' }] },
      { id: 'le', source: 'low', target: 'e' },
      { id: 'he', source: 'high', target: 'e' },
    ],
  };
  const amount = expenseBranchAmount([{ totalAmount: 80.5 }, { totalAmount: 40 }]);
  assert.equal(amount, '120.50');
  assert.deepEqual(planWorkflowExecution('expense', graph, { amount }).steps.map((step) => step.kind === 'approver' ? step.approverId : step.kind), ['U002']);

  const now = 1_700_000_000_000;
  const signed = signExpenseFile('/uploads/123_abcdef.png', now);
  const url = new URL(signed, 'http://127.0.0.1');
  const name = decodeURIComponent(url.pathname.split('/').pop() || '');
  assert.equal(verifyExpenseFileSignature(name, url.searchParams.get('exp'), url.searchParams.get('sig'), now + 1000), true);
  assert.equal(verifyExpenseFileSignature(name, url.searchParams.get('exp'), url.searchParams.get('sig'), now + 4 * 60 * 60 * 1000 + 1), false);
  assert.equal(verifyExpenseFileSignature('../config.ts', url.searchParams.get('exp'), url.searchParams.get('sig'), now), false);
});
