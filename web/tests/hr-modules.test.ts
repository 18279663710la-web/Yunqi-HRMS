import assert from 'node:assert/strict';
import test from 'node:test';
import { PAGE_TITLES, SUB_MODULES, accessibleSubModules, matchSubModule, resolvePageKey, subModuleLabel, subModuleMetrics } from '../src/layout/subModules';

test('审批管理包含审批流程、自定义审批和审批汇总', () => {
  const approvals = SUB_MODULES.find(module => module.key === '/approvals');
  assert.ok(approvals);
  assert.deepEqual(approvals.items.map(item => [item.key, item.label]), [['/approvals/workflow', '审批流程'], ['/approvals/custom', '自定义审批'], ['/approvals/summary', '审批汇总']]);
  assert.equal(matchSubModule('/approvals/workflow')?.key, '/approvals');
  assert.equal(resolvePageKey('/approvals/workflow'), '/approvals/workflow');
  assert.equal(resolvePageKey('/approvals/summary'), '/approvals/summary');
  assert.ok(accessibleSubModules('hr_admin').some(module => module.key === '/approvals'));
  assert.ok(!accessibleSubModules('super_admin').find(module => module.key === '/approvals')?.items.some(item => item.key === '/approvals/custom-workflow'));
  assert.ok(!accessibleSubModules('hr_admin').some(module => module.key === '/hr'));
  assert.ok(accessibleSubModules('super_admin').some(module => module.key === '/hr'));
});

test('人事管理将工资批次、发放和发放记录分为独立子模块', () => {
  const hr = SUB_MODULES.find(module => module.key === '/hr');
  assert.ok(hr);
  assert.equal(hr.title, '人事管理');
  assert.equal(hr.sidebarId, 'hr-sidebar');
  assert.deepEqual(hr.items.map(item => item.label), ['入职管理', '员工档案', '工资批次', '工资发放', '工资发放记录', '离职管理']);
  assert.deepEqual(hr.items.map(item => item.key), ['/hr/onboarding', '/hr/employees', '/hr/payroll-batches', '/hr/payroll-disbursement', '/hr/payroll-records', '/hr/offboarding']);
});

test('模块路径按边界匹配，避免误匹配相似前缀', () => {
  assert.equal(matchSubModule('/hr/employees')?.key, '/hr');
  assert.equal(matchSubModule('/hr')?.key, '/hr');
  assert.equal(matchSubModule('/hrx'), undefined);
  assert.equal(matchSubModule('/models-formulas/salary')?.key, '/models-formulas');
});

test('模型与公式保留入职申请表设置，不包含离职申请表设置或审批流程', () => {
  const models = SUB_MODULES.find(module => module.key === '/models-formulas');
  assert.ok(models);
  assert.ok(models.items.some(item => item.key === '/models-formulas/onboarding-template' && item.label === '入职申请表设置'));
  assert.ok(!models.items.some(item => item.key === '/models-formulas/offboarding-template' || item.label === '离职申请表设置'));
  assert.ok(!models.items.some(item => item.label === '自定义审批流程'));
});

test('页面标题和侧栏选中项使用最长前缀', () => {
  assert.equal(PAGE_TITLES['/hr/employees'], '员工档案');
  assert.equal(resolvePageKey('/hr/employees'), '/hr/employees');
  assert.equal(resolvePageKey('/hr/employees/extra'), '/hr/employees');
  assert.equal(resolvePageKey('/models-formulas/salary'), '/models-formulas/salary');
  assert.equal(resolvePageKey('/unknown'), '/dashboard');
  assert.equal(subModuleLabel('/hr/payroll-batches'), '工资批次');
  assert.equal(subModuleLabel('/hr/payroll-disbursement'), '工资发放');
  assert.equal(subModuleLabel('/hr/payroll-records'), '工资发放记录');
  assert.equal(subModuleLabel('/hr'), undefined);
});

test('子侧栏选项宽度取最长子模块名称', () => {
  const models = SUB_MODULES.find(module => module.key === '/models-formulas');
  const hr = SUB_MODULES.find(module => module.key === '/hr');
  assert.ok(models);
  assert.ok(hr);
  assert.deepEqual(subModuleMetrics(models), { itemWidth: 7 * 13 + 32, sidebarWidth: 7 * 13 + 32 + 24 });
  assert.deepEqual(subModuleMetrics(hr), { itemWidth: 6 * 13 + 32, sidebarWidth: 6 * 13 + 32 + 24 });
});
