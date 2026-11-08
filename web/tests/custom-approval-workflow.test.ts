import assert from 'node:assert/strict';
import test from 'node:test';
import { canConnectApprovalNodes, createApprovalNode, serializeApprovalWorkflow } from '../src/modules/approvals/customApprovalWorkflowGraph';
import { APPROVAL_TYPE_DEFINITIONS, isNodeAvailable } from '../src/modules/approvals/approvalTypeDefinitions';

test('审批节点和连线只保存独立设计稿需要的结构', () => {
  const form = createApprovalNode('form', { x: 120, y: 50 });
  const approver = createApprovalNode('approver', { x: 480, y: 50 });
  const result = serializeApprovalWorkflow(3, [{ ...form, selected: true }, approver], [{ id: 'edge', source: form.id, target: approver.id, selected: true }]);
  assert.deepEqual(result, { version: 3, nodes: [
    { id: form.id, kind: 'form', position: { x: 120, y: 50 } },
    { id: approver.id, kind: 'approver', position: { x: 480, y: 50 } },
  ], edges: [{ id: 'edge', source: form.id, target: approver.id }] });
});

test('审批设计稿禁止连接自身、重复连线或未知节点', () => {
  const nodes = new Set(['a', 'b']);
  const edges = [{ source: 'a', target: 'b' }];
  assert.equal(canConnectApprovalNodes(nodes, edges, 'a', 'b'), false);
  assert.equal(canConnectApprovalNodes(nodes, edges, 'a', 'a'), false);
  assert.equal(canConnectApprovalNodes(nodes, edges, 'a', 'c'), false);
  assert.equal(canConnectApprovalNodes(nodes, edges, 'b', 'a'), true);
});

test('表单、审批人和分支条件随设计稿一起序列化', () => {
  const reviewer = { ...createApprovalNode('approver', { x: 0, y: 0 }), data: { kind: 'approver' as const, config: { approverIds: ['U005', 'U011'] } } };
  const branch = createApprovalNode('branch', { x: 300, y: 0 });
  const conditions = [{ field: 'amount', operator: 'gte' as const, value: '1000' }];
  const fields = [{ key: 'project', label: '项目类型', type: 'picker' as const, required: true, options: ['内部', '客户'] }];
  const result = serializeApprovalWorkflow(4, [branch, reviewer], [{ id: 'route', source: branch.id, target: reviewer.id, data: { conditions } }], fields);
  assert.deepEqual(result.formFields, fields);
  assert.deepEqual(result.nodes[1].config, { approverIds: ['U005', 'U011'] });
  assert.deepEqual(result.edges[0].conditions, conditions);
});

test('各审批显示各自固定字段，发票查验节点仅供报销添加', () => {
  assert.ok(APPROVAL_TYPE_DEFINITIONS.leave.fixedFields.includes('请假类型'));
  assert.ok(APPROVAL_TYPE_DEFINITIONS.overtime.fixedFields.includes('加班事由'));
  assert.ok(!APPROVAL_TYPE_DEFINITIONS.overtime.fixedFields.includes('补偿方式'));
  assert.equal(APPROVAL_TYPE_DEFINITIONS.travel.numericCondition?.value, 'budget');
  assert.equal(APPROVAL_TYPE_DEFINITIONS.purchase.numericCondition?.value, 'amount');
  assert.equal(isNodeAvailable('expense', 'verify'), true);
  assert.equal(isNodeAvailable('expense', 'ai'), true);
  for (const type of ['leave', 'overtime', 'travel', 'purchase'] as const) {
    assert.equal(isNodeAvailable(type, 'verify'), false);
    assert.equal(isNodeAvailable(type, 'ai'), false);
    assert.equal(isNodeAvailable(type, 'approver'), true);
    assert.equal(isNodeAvailable(type, 'branch'), true);
  }
});
