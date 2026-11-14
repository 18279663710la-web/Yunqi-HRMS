import assert from 'node:assert/strict';
import test from 'node:test';
import { employeeApprovalFields, normalizeEditableFormFields } from '../src/domains/approvals/approvalFormFields';
import { validateCustomWorkflowGraph } from '../src/domains/approvals/customWorkflowService';

test('原固定字段可保存为自定义字段，报销附件字段保持固定', () => {
  const workflow = {
    version: 1,
    fieldsInitialized: true,
    formFields: [
      { key: 'reason', label: '费用说明', type: 'textarea' as const, required: true },
      { key: 'invoiceFiles', label: '改名', type: 'text' as const, required: false },
      { key: 'amount', label: '报销金额（元）', type: 'money' as const, required: true },
    ],
    nodes: [],
    edges: [],
  };
  validateCustomWorkflowGraph('expense', workflow);
  assert.deepEqual(workflow.formFields.map(field => field.key), ['reason', 'invoiceFiles', 'amount', 'supplementFiles']);
  assert.deepEqual(workflow.formFields[1], { key: 'invoiceFiles', label: '发票附件', type: 'attachment', required: true, locked: true });
  assert.throws(() => normalizeEditableFormFields('leave', [{ key: 'invoiceFiles', label: '发票附件', type: 'attachment', required: true }], false));
});

test('已转换的表单按设计顺序展示，旧发布快照仍把固定字段放在前面', () => {
  const fixed = [{ key: 'amount', label: '报销金额（元）', type: 'money' as const, required: true }];
  const legacy = employeeApprovalFields('expense', fixed, [{ key: 'project', label: '项目', type: 'text', required: false }]);
  assert.deepEqual(legacy.map(field => field.key), ['amount', 'project']);
  const converted = employeeApprovalFields('expense', fixed, [
    { key: 'project', label: '项目', type: 'text', required: false },
    { key: 'amount', label: '金额', type: 'money', required: true },
    { key: 'invoiceFiles', label: '发票附件', type: 'attachment', required: true, locked: true },
  ]);
  assert.deepEqual(converted.map(field => field.key), ['project', 'amount', 'invoiceFiles']);
});
