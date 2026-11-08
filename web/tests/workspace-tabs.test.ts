import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceTabs, openWorkspaceTab, closeWorkspaceTab, workspaceTabForLocation } from '../src/layout/workspaceTabs';

const loc = (pathname: string, search = '') => ({ pathname, search, hash: '', state: null, key: 'test' });

test('五类审批各自打开独立页签，旧入口仍指向请假审批', () => {
  let tabs = createWorkspaceTabs(loc('/dashboard'));
  const types = [['leave', '请假审批'], ['expense', '报销审批'], ['overtime', '加班审批'], ['travel', '出差审批'], ['purchase', '采购审批']];
  for (const [type] of types) tabs = openWorkspaceTab(tabs, loc(`/approvals/${type}`));
  assert.deepEqual(tabs.slice(1).map(tab => [tab.key, tab.label]), types.map(([type, label]) => [`/approvals/${type}`, label]));
  assert.equal(workspaceTabForLocation(loc('/approvals')).key, '/approvals/leave');
});

test('首页固定，直接访问子模块时一并打开对应页签', () => {
  const tabs = createWorkspaceTabs(loc('/models-formulas/salary'));
  assert.deepEqual(tabs.map(tab => [tab.key, tab.label]), [['/dashboard', '首页'], ['/models-formulas/salary', '薪资构成模型']]);
  assert.equal(workspaceTabForLocation(loc('/hr/payroll')).key, '/hr/payroll-batches');
  assert.equal(workspaceTabForLocation(loc('/approvals/expense')).label, '报销审批');
});

test('旧流程页面地址复用请假审批页签', () => {
  const oldTab = workspaceTabForLocation(loc('/models-formulas/payroll-workflow'));
  assert.equal(oldTab.key, '/approvals/leave');
  assert.equal(oldTab.label, '请假审批');
  const tabs = openWorkspaceTab(createWorkspaceTabs(loc('/models-formulas/payroll-workflow')), loc('/approvals/custom-workflow'));
  assert.equal(tabs.filter(tab => tab.key === '/approvals/leave').length, 1);
});

test('重复打开复用已有页签并更新地址参数', () => {
  let tabs = createWorkspaceTabs(loc('/dashboard'));
  tabs = openWorkspaceTab(tabs, loc('/employees'));
  tabs = openWorkspaceTab(tabs, loc('/hr/employees'));
  tabs = openWorkspaceTab(tabs, loc('/employees', '?create=1'));
  assert.deepEqual(tabs.map(tab => tab.key), ['/dashboard', '/employees', '/hr/employees']);
  assert.equal(tabs[1].location.search, '?create=1');
});

test('发放记录明细按工资月份打开独立页签', () => {
  let tabs = createWorkspaceTabs(loc('/hr/payroll-records'));
  tabs = openWorkspaceTab(tabs, loc('/hr/payroll-records/12/2026-10'));
  tabs = openWorkspaceTab(tabs, loc('/hr/payroll-records/13/2026-11'));
  assert.deepEqual(tabs.slice(-2).map(tab => [tab.key, tab.label]), [['/hr/payroll-records/12/2026-10', '2026-10发放记录 #12'], ['/hr/payroll-records/13/2026-11', '2026-11发放记录 #13']]);
});

test('关闭非当前页保留当前页，关闭当前页切换相邻页，首页不能关闭', () => {
  let tabs = createWorkspaceTabs(loc('/dashboard'));
  tabs = openWorkspaceTab(tabs, loc('/hr/onboarding'));
  tabs = openWorkspaceTab(tabs, loc('/models-formulas/salary'));
  const inactive = closeWorkspaceTab(tabs, '/hr/onboarding', '/models-formulas/salary');
  assert.equal(inactive.nextLocation, null);
  const active = closeWorkspaceTab(tabs, '/models-formulas/salary', '/models-formulas/salary');
  assert.equal(active.nextLocation?.pathname, '/hr/onboarding');
  assert.deepEqual(closeWorkspaceTab(tabs, '/dashboard', '/dashboard').tabs, tabs);
});
