import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveExpenseWorkflow, validateExpenseWorkflow } from '../src/domains/approvals/expenseWorkflowPolicy';

const config = {
  version: 1,
  enabled: true,
  fields: [{ key: 'project', label: '项目类型', type: 'picker', required: true, options: ['内部', '客户'] }],
  branches: [
    { conditions: [{ field: 'amount', operator: 'gte', value: '1000' }, { field: 'project', operator: 'eq', value: '客户' }], approvers: ['U001', 'U005'] },
    { conditions: [{ field: 'amount', operator: 'lt', value: '1000' }, { field: 'project', operator: 'eq', value: '客户' }], approvers: ['U011'] },
  ],
};

test('金额和选项同时满足时选择唯一分支，无匹配时阻止提交', () => {
  const valid = validateExpenseWorkflow(config);
  assert.deepEqual(resolveExpenseWorkflow(valid, '1000.00', { project: '客户' }), ['U001', 'U005']);
  assert.deepEqual(resolveExpenseWorkflow(valid, '999.99', { project: '客户' }), ['U011']);
  assert.throws(() => resolveExpenseWorkflow(valid, '1000', { project: '内部' }), /未匹配|未配置/);
});

test('范围或选项相交的分支以及互相矛盾的条件不允许保存', () => {
  assert.throws(() => validateExpenseWorkflow({ ...config, branches: [...config.branches, { conditions: [{ field: 'amount', operator: 'gte', value: '999' }], approvers: ['U001'] }] }), /重叠/);
  assert.throws(() => validateExpenseWorkflow({ ...config, branches: [{ conditions: [{ field: 'amount', operator: 'gte', value: '1000' }, { field: 'amount', operator: 'lt', value: '1000' }], approvers: ['U001'] }] }), /条件/);
});

test('缺少必填值、无效选项、错误金额或未知字段不能生成审批流程', () => {
  const valid = validateExpenseWorkflow(config);
  assert.throws(() => resolveExpenseWorkflow(valid, '100', {}));
  assert.throws(() => resolveExpenseWorkflow(valid, '100', { project: '其他' }));
  assert.throws(() => resolveExpenseWorkflow(valid, '1.001', { project: '客户' }));
  assert.throws(() => validateExpenseWorkflow({ ...config, branches: [{ ...config.branches[0], conditions: [{ field: 'unknown', operator: 'eq', value: '客户' }] }] }));
});

test('固定报销类型可用于条件判断，不同选项的分支不会重叠', () => {
  const valid = validateExpenseWorkflow({ ...config, branches: [
    { conditions: [{ field: 'expenseType', operator: 'eq', value: '差旅费' }], approvers: ['U001'] },
    { conditions: [{ field: 'expenseType', operator: 'eq', value: '交通费' }], approvers: ['U005'] },
  ] });
  assert.deepEqual(resolveExpenseWorkflow(valid, '100', { project: '内部', expenseType: '交通费' }), ['U005']);
  assert.throws(() => validateExpenseWorkflow({ ...config, branches: [{ conditions: [{ field: 'expenseType', operator: 'eq', value: '不存在' }], approvers: ['U001'] }] }));
});
