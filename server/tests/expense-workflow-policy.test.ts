import assert from 'node:assert/strict';
import test from 'node:test';
import { validateWorkflowConditions } from '../src/domains/approvals/expenseWorkflowPolicy';

const policy = { reserved: [], labels: [], numericField: 'amount', choices: { project: ['内部', '客户'], expenseType: ['差旅费', '招待费', '办公用品', '交通费', '其他'] } };
const config = {
  version: 1,
  enabled: true,
  fields: [{ key: 'project', label: '项目类型', type: 'picker', required: true, options: ['内部', '客户'] }],
  branches: [
    { conditions: [{ field: 'amount', operator: 'gte', value: '1000' }, { field: 'project', operator: 'eq', value: '客户' }], approvers: ['U001', 'U005'] },
    { conditions: [{ field: 'amount', operator: 'lt', value: '1000' }, { field: 'project', operator: 'eq', value: '客户' }], approvers: ['U011'] },
  ],
};

test('范围或选项相交的分支以及互相矛盾的条件不允许保存', () => {
  assert.ok(validateWorkflowConditions(config, policy));
  assert.throws(() => validateWorkflowConditions({ ...config, branches: [...config.branches, { conditions: [{ field: 'amount', operator: 'gte', value: '999' }], approvers: ['U001'] }] }, policy), /重叠/);
  assert.throws(() => validateWorkflowConditions({ ...config, branches: [{ conditions: [{ field: 'amount', operator: 'gte', value: '1000' }, { field: 'amount', operator: 'lt', value: '1000' }], approvers: ['U001'] }] }, policy), /条件/);
  assert.throws(() => validateWorkflowConditions({ ...config, fields: [...config.fields, { ...config.fields[0] }] }, policy), /重复/);
});

test('未知字段或不存在的选项不能作为分支条件，预设报销类型选项可用', () => {
  assert.ok(validateWorkflowConditions({ ...config, branches: [
    { conditions: [{ field: 'expenseType', operator: 'eq', value: '差旅费' }], approvers: ['U001'] },
    { conditions: [{ field: 'expenseType', operator: 'eq', value: '交通费' }], approvers: ['U005'] },
  ] }, policy));
  assert.throws(() => validateWorkflowConditions({ ...config, branches: [{ conditions: [{ field: 'unknown', operator: 'eq', value: '客户' }], approvers: ['U001'] }] }, policy), /分支条件无效/);
  assert.throws(() => validateWorkflowConditions({ ...config, branches: [{ conditions: [{ field: 'expenseType', operator: 'eq', value: '不存在' }], approvers: ['U001'] }] }, policy), /分支条件无效/);
  assert.throws(() => validateWorkflowConditions({ ...config, branches: [{ conditions: [{ field: 'project', operator: 'gte', value: '1000' }], approvers: ['U001'] }] }, policy), /分支条件无效/);
});
