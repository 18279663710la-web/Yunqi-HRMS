import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCustomWorkflowGraph } from '../src/domains/approvals/customWorkflowService';

const graph = {
  version: 0,
  formFields: [{ key: 'project', label: '项目类型', type: 'picker' as const, required: true, options: ['内部', '客户'] }],
  nodes: [
    { id: 'branch', kind: 'branch' as const, position: { x: 0, y: 0 } },
    { id: 'a', kind: 'approver' as const, position: { x: 200, y: 0 }, config: { approverIds: ['U001', 'U002'] } },
    { id: 'b', kind: 'end' as const, position: { x: 200, y: 100 } },
  ],
  edges: [
    { id: 'one', source: 'branch', target: 'a', conditions: [{ field: 'project', operator: 'eq' as const, value: '客户' }] },
    { id: 'two', source: 'branch', target: 'b', conditions: [{ field: 'project', operator: 'eq' as const, value: '内部' }] },
  ],
};

test('四种审批可保存各自的自定义表单、顺序审批人及互斥选项分支', () => {
  for (const type of ['leave', 'overtime', 'travel', 'purchase'] as const) assert.doesNotThrow(() => validateCustomWorkflowGraph(type, graph));
});

test('请假类型和时长、出差预算、采购预估金额只在对应审批中可作为分支', () => {
  const withCondition = (field: string, operator: 'eq' | 'gte', value: string) => ({ ...graph, edges: [{ ...graph.edges[0], conditions: [{ field, operator, value }] }] });
  assert.doesNotThrow(() => validateCustomWorkflowGraph('leave', withCondition('leaveType', 'eq', '病假')));
  assert.doesNotThrow(() => validateCustomWorkflowGraph('leave', withCondition('days', 'gte', '3')));
  assert.doesNotThrow(() => validateCustomWorkflowGraph('travel', withCondition('budget', 'gte', '1000')));
  assert.doesNotThrow(() => validateCustomWorkflowGraph('purchase', withCondition('amount', 'gte', '1000')));
  assert.throws(() => validateCustomWorkflowGraph('overtime', withCondition('expenseType', 'eq', '差旅费')));
});

test('条件分支不可重叠，不能删除引用字段，也不能使用补偿方式作为字段名', () => {
  const overlap = { ...graph, edges: [...graph.edges, { id: 'three', source: 'branch', target: 'a2', conditions: [{ field: 'project', operator: 'eq' as const, value: '客户' }] }], nodes: [...graph.nodes, { id: 'a2', kind: 'end' as const, position: { x: 400, y: 0 } }] };
  assert.throws(() => validateCustomWorkflowGraph('leave', overlap), /重叠/);
  assert.throws(() => validateCustomWorkflowGraph('leave', { ...graph, formFields: [] }), /条件/);
  assert.throws(() => validateCustomWorkflowGraph('purchase', { ...graph, formFields: [{ key: 'x', label: '补偿方式', type: 'text', required: false }] }), /重复/);
  assert.doesNotThrow(() => validateCustomWorkflowGraph('purchase', { version: 0, formFields: [{ key: 'item', label: '采购物品', type: 'text', required: true }], nodes: [], edges: [] }));
});
