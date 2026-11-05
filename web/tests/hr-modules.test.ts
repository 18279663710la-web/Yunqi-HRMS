import assert from 'node:assert/strict';
import test from 'node:test';
import { PAGE_TITLES, SUB_MODULES, matchSubModule, resolvePageKey, subModuleLabel, subModuleMetrics } from '../src/layout/subModules';

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

test('模型与公式包含入职申请表设置和薪资发放流程子模块', () => {
  const models = SUB_MODULES.find(module => module.key === '/models-formulas');
  assert.ok(models);
  assert.ok(models.items.some(item => item.key === '/models-formulas/onboarding-template' && item.label === '入职申请表设置'));
  assert.ok(models.items.some(item => item.key === '/models-formulas/payroll-workflow' && item.label === '薪资发放流程'));
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
