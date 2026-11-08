import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PAYROLL_WORKFLOW_PRESETS,
  canConnect,
  createWorkflowEdge,
  createWorkflowNode,
  createLinkedWorkflowAddition,
  serializeWorkflow,
  workflowSignature,
} from '../src/modules/models-formulas/payroll-workflow/workflowUtils';

test('薪资发放流程包含六种预设节点', () => {
  assert.deepEqual(PAYROLL_WORKFLOW_PRESETS.map(preset => preset.title), [
    '系统算薪',
    '手动调整',
    '复核',
    '输出工资条',
    '发送到对应员工的小程序端',
    '导入其他字段',
  ]);
});

test('从节点添加后续节点时创建连接并保留原节点位置', () => {
  const source = createWorkflowNode('system-calc', { x: 120, y: 80 });
  const result = createLinkedWorkflowAddition('review', source.id, [source]);
  assert.ok(result);
  assert.equal(result.node.data.kind, 'review');
  assert.ok(result.node.position.x > source.position.x);
  assert.equal(result.node.position.y, source.position.y);
  assert.equal(result.edge.source, source.id);
  assert.equal(result.edge.target, result.node.id);
  assert.deepEqual(source.position, { x: 120, y: 80 });
});

test('来源节点不存在时不创建后续节点或连线', () => {
  assert.equal(createLinkedWorkflowAddition('review', 'missing', []), null);
});

test('从同一个节点添加多个分支时避免节点重叠', () => {
  const source = createWorkflowNode('system-calc', { x: 100, y: 50 });
  const first = createLinkedWorkflowAddition('review', source.id, [source]);
  assert.ok(first);
  const second = createLinkedWorkflowAddition('payslip', source.id, [source, first.node]);
  assert.ok(second);
  assert.equal(second.node.position.x, first.node.position.x);
  assert.ok(second.node.position.y >= first.node.position.y + 64);
});

test('节点和连线工厂生成可保存的结构', () => {
  const node = createWorkflowNode('review', { x: 10, y: 20 });
  assert.equal(node.type, 'payroll');
  assert.equal(node.data.kind, 'review');
  assert.deepEqual(node.position, { x: 10, y: 20 });
  assert.match(node.id, /^node-/);
  const edge = createWorkflowEdge('a', 'b');
  assert.equal(edge.source, 'a');
  assert.equal(edge.target, 'b');
  assert.match(edge.id, /^edge-/);
});

test('连线禁止自连、重复和未知节点', () => {
  const ids = new Set(['a', 'b']);
  assert.deepEqual(canConnect(ids, [], 'a', 'b'), { ok: true });
  assert.equal(canConnect(ids, [], 'a', 'a').ok, false);
  assert.equal(canConnect(ids, [{ source: 'a', target: 'b' }], 'a', 'b').ok, false);
  assert.equal(canConnect(ids, [], 'a', 'missing').ok, false);
});

test('序列化剥离画布运行时字段并保留位置和连线', () => {
  const nodes = [{ id: 'n1', type: 'payroll', position: { x: 12, y: 34 }, data: { kind: 'system-calc' as const }, selected: true, width: 190 }];
  const edges = [{ id: 'e1', source: 'n1', target: 'n2', selected: true }];
  assert.deepEqual(serializeWorkflow(3, nodes, edges), {
    version: 3,
    nodes: [{ id: 'n1', type: 'payroll', position: { x: 12, y: 34 }, data: { kind: 'system-calc' } }],
    edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
  });
  assert.notEqual(
    workflowSignature(3, nodes, edges),
    workflowSignature(3, [{ ...nodes[0], position: { x: 50, y: 34 } }], edges)
  );
});
