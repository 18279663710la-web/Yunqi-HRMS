import assert from 'node:assert/strict';
import test from 'node:test';
import { simulateApprovalWorkflow, validateExecutableWorkflow } from '../src/domains/approvals/customWorkflowSimulation';
import type { CustomWorkflow } from '../src/domains/approvals/customWorkflowService';

const workflow: CustomWorkflow = {
  version: 1,
  formFields: [{ key: 'project', label: '项目', type: 'picker', required: true, options: ['内部', '客户'] }],
  nodes: [
    { id: 'start', kind: 'start', position: { x: 0, y: 0 } },
    { id: 'branch', kind: 'branch', position: { x: 1, y: 0 } },
    { id: 'review', kind: 'approver', position: { x: 2, y: 0 }, config: { approverIds: ['U001'] } },
    { id: 'end', kind: 'end', position: { x: 3, y: 0 }, config: { outcome: 'approved' } },
  ],
  edges: [
    { id: 'a', source: 'start', target: 'branch' },
    { id: 'b', source: 'branch', target: 'review', conditions: [{ field: 'project', operator: 'eq', value: '客户' }] },
    { id: 'c', source: 'review', target: 'end' },
  ],
};

test('测试用例匹配分支并按顺序到达审批人及结束节点', () => {
  assert.deepEqual(validateExecutableWorkflow('leave', workflow), []);
  const result = simulateApprovalWorkflow(workflow, { project: '客户' });
  assert.equal(result.passed, true);
  assert.deepEqual(result.path, ['start', 'branch', 'review', 'end']);
  assert.deepEqual(result.approverIds, ['U001']);
  assert.equal(result.outcome, 'approved');
});

test('分支不匹配不得视为测试通过', () => {
  const result = simulateApprovalWorkflow(workflow, { project: '内部' });
  assert.equal(result.passed, false);
  assert.match(result.error ?? '', /未匹配/);
});

test('不可执行的画布不能通过结构检查', () => {
  const unconfigured = { ...workflow, nodes: workflow.nodes.map(node => node.id === 'review' ? { ...node, config: undefined } : node) };
  assert.ok(validateExecutableWorkflow('leave', unconfigured).some(error => error.includes('审批人')));
  const multiApprover = { ...workflow, nodes: workflow.nodes.map(node => node.id === 'review' ? { ...node, config: { approverIds: ['U001', 'U002'] } } : node) };
  assert.ok(validateExecutableWorkflow('leave', multiApprover).some(error => error.includes('只能选择一名审批人')));
  const cycle = { ...workflow, edges: [...workflow.edges, { id: 'd', source: 'end', target: 'start' }] };
  assert.ok(validateExecutableWorkflow('leave', cycle).length > 0);
  const disconnected = { ...workflow, nodes: [...workflow.nodes, { id: 'orphan', kind: 'end' as const, position: { x: 5, y: 0 } }] };
  assert.ok(validateExecutableWorkflow('leave', disconnected).some(error => error.includes('未连接')));
});

test('数值边界使用大于等于和小于判断', () => {
  const numeric = { ...workflow, edges: workflow.edges.map(edge => edge.id === 'b' ? { ...edge, conditions: [{ field: 'days', operator: 'gte' as const, value: '3' }] } : edge) };
  assert.equal(simulateApprovalWorkflow(numeric, { days: '3' }).passed, true);
  assert.equal(simulateApprovalWorkflow(numeric, { days: '2.99' }).passed, false);
  assert.equal(simulateApprovalWorkflow(numeric, { days: '' }).passed, false);
});

test('未配置完整的 AI 节点、分叉普通节点不能通过检查', () => {
  const withAi = { ...workflow, nodes: [...workflow.nodes, { id: 'ai', kind: 'ai' as const, position: { x: 0, y: 0 }, config: { provider: 'deepseek' as const, model: 'test', baseUrl: 'https://example.test', rules: '规则' } }] };
  assert.ok(validateExecutableWorkflow('expense', withAi).some(error => error.includes('AI')));
  const duplicateOutgoing = { ...workflow, edges: [...workflow.edges, { id: 'd', source: 'start', target: 'end' }] };
  assert.ok(validateExecutableWorkflow('leave', duplicateOutgoing).some(error => error.includes('后续节点')));
});

test('重叠分支不会被视作通过，驳回结束节点如实返回结果', () => {
  const overlap = { ...workflow, edges: [...workflow.edges, { id: 'd', source: 'branch', target: 'end', conditions: [{ field: 'project', operator: 'eq' as const, value: '客户' }] }] };
  assert.match(simulateApprovalWorkflow(overlap, { project: '客户' }).error ?? '', /多条/);
  const rejected = { ...workflow, nodes: workflow.nodes.map(node => node.id === 'end' ? { ...node, config: { outcome: 'rejected' as const } } : node) };
  assert.equal(simulateApprovalWorkflow(rejected, { project: '客户' }).outcome, 'rejected');
});

test('运行测试时检查 AI 地址并返回每条用例的路径', async () => {
  const { runWorkflowTests } = await import('../src/domains/approvals/customWorkflowSimulation');
  const graph: CustomWorkflow = {
    ...workflow,
    nodes: [...workflow.nodes, { id: 'ai', kind: 'ai', position: { x: 2, y: 1 }, config: { provider: 'deepseek', model: 'model', rules: '规则', baseUrl: 'https://example.test', hasApiKey: true } }],
    edges: workflow.edges.map(edge => edge.id === 'b' ? { ...edge, target: 'ai' } : edge).concat([{ id: 'd', source: 'ai', target: 'review' }]),
  };
  const calls: string[] = [];
  const result = await runWorkflowTests('expense', graph, [{ name: '客户项目', values: { project: '客户' } }], async url => { calls.push(url); return { reachable: true, status: 404 }; });
  assert.equal(result.passed, true);
  assert.deepEqual(calls, ['https://example.test']);
  assert.deepEqual(result.cases[0].path, ['start', 'branch', 'ai', 'review', 'end']);
  assert.equal(result.aiChecks[0].status, 404);
  const failed = await runWorkflowTests('expense', graph, [{ name: '客户项目', values: { project: '客户' } }], async () => ({ reachable: false }));
  assert.equal(failed.passed, false);
});

test('空测试用例不能通过', async () => {
  const { runWorkflowTests } = await import('../src/domains/approvals/customWorkflowSimulation');
  const result = await runWorkflowTests('leave', workflow, []);
  assert.equal(result.passed, false);
});

test('AI 建议必须有后续人工审批，不能直接流向结束节点', () => {
  const ai: CustomWorkflow = { ...workflow,
    nodes: [...workflow.nodes, { id: 'ai', kind: 'ai', position: { x: 2, y: 1 }, config: { provider: 'deepseek', model: 'model', rules: '规则', baseUrl: 'https://example.test', hasApiKey: true } }],
    edges: workflow.edges.map(edge => edge.id === 'c' ? { ...edge, target: 'ai' } : edge).concat([{ id: 'd', source: 'ai', target: 'end' }]),
  };
  assert.ok(validateExecutableWorkflow('expense', ai).some(error => error.includes('人工审批')));
});

test('将匹配路径展开成顺序审批人与 AI 节点执行计划', async () => {
  const { planWorkflowExecution } = await import('../src/domains/approvals/customWorkflowExecutionPlan');
  const graph: CustomWorkflow = { ...workflow,
    nodes: [...workflow.nodes, { id: 'ai', kind: 'ai', position: { x: 2, y: 1 }, config: { provider: 'deepseek', model: 'model', rules: '规则', baseUrl: 'https://example.test', hasApiKey: true } }],
    edges: workflow.edges.map(edge => edge.id === 'b' ? { ...edge, target: 'ai' } : edge).concat([{ id: 'd', source: 'ai', target: 'review' }]),
  };
  assert.deepEqual(planWorkflowExecution('expense', graph, { project: '客户' }), {
    steps: [{ kind: 'ai', nodeId: 'ai' }, { kind: 'approver', nodeId: 'review', approverId: 'U001' }],
    outcome: 'approved',
  });
  assert.throws(() => planWorkflowExecution('expense', graph, { project: '内部' }), /未匹配/);
});

test('报销流程的所有结束路径都必须经过人工审批', () => {
  const graph: CustomWorkflow = { version: 1, formFields: [], nodes: [
    { id: 's', kind: 'start', position: { x: 0, y: 0 } }, { id: 'e', kind: 'end', position: { x: 1, y: 0 } },
  ], edges: [{ id: 'se', source: 's', target: 'e' }] };
  assert.ok(validateExecutableWorkflow('expense', graph).some(error => error.includes('人工审批')));
});

test('多个节点配置相同地址时只检测一次连通性', async () => {
  const { runWorkflowTests } = await import('../src/domains/approvals/customWorkflowSimulation');
  const aiConfig = { provider: 'deepseek' as const, model: 'model', rules: '规则', baseUrl: 'https://example.test', hasApiKey: true };
  const graph: CustomWorkflow = { ...workflow, nodes: [...workflow.nodes,
    { id: 'ai1', kind: 'ai', position: { x: 2, y: 1 }, config: aiConfig },
    { id: 'ai2', kind: 'ai', position: { x: 3, y: 1 }, config: aiConfig },
  ], edges: workflow.edges.map(edge => edge.id === 'b' ? { ...edge, target: 'ai1' } : edge).concat([
    { id: 'd', source: 'ai1', target: 'ai2' }, { id: 'e', source: 'ai2', target: 'review' },
  ]) };
  let calls = 0;
  const report = await runWorkflowTests('expense', graph, [{ name: '客户', values: { project: '客户' } }], async () => { calls += 1; return { reachable: true, status: 200 }; });
  assert.equal(report.passed, true);
  assert.equal(report.aiChecks.length, 2);
  assert.equal(calls, 1);
});


test('执行计划保留系统查验节点的顺序和查验开关，缺省时两项都做', async () => {
  const { planWorkflowExecution, expenseVerificationSelection } = await import('../src/domains/approvals/customWorkflowExecutionPlan');
  const graph: CustomWorkflow = { ...workflow, nodes: [...workflow.nodes, { id: 'verify', kind: 'verify', position: { x: 1, y: 1 } }],
    edges: workflow.edges.map(edge => edge.id === 'a' ? { ...edge, target: 'verify' } : edge).concat([{ id: 'vb', source: 'verify', target: 'branch' }]) };
  const plan = planWorkflowExecution('expense', graph, { project: '客户' });
  assert.deepEqual(plan.steps[0], { kind: 'verify', nodeId: 'verify', checkDuplicate: true, verifyInvoice: true });
  assert.deepEqual(expenseVerificationSelection(plan.steps), { checkDuplicate: true, verifyInvoice: true });
  assert.deepEqual(expenseVerificationSelection([]), { checkDuplicate: true, verifyInvoice: true });
  const skipped: CustomWorkflow = { ...graph, nodes: graph.nodes.map(node => node.id === 'verify' ? { ...node, config: { checkDuplicate: false, verifyInvoice: false } } : node) };
  const off = planWorkflowExecution('expense', skipped, { project: '客户' });
  assert.deepEqual(off.steps[0], { kind: 'verify', nodeId: 'verify', checkDuplicate: false, verifyInvoice: false });
  assert.deepEqual(expenseVerificationSelection(off.steps), { checkDuplicate: false, verifyInvoice: false });
  const mixed: CustomWorkflow = { ...skipped, nodes: [...skipped.nodes, { id: 'verify2', kind: 'verify', position: { x: 1, y: 2 }, config: { checkDuplicate: true, verifyInvoice: false } }],
    edges: skipped.edges.map(edge => edge.id === 'vb' ? { ...edge, target: 'verify2' } : edge).concat([{ id: 'v2', source: 'verify2', target: 'branch' }]) };
  assert.deepEqual(expenseVerificationSelection(planWorkflowExecution('expense', mixed, { project: '客户' }).steps), { checkDuplicate: true, verifyInvoice: false });
});
