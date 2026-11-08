import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { App } from 'antd';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmployeeRecordsToolbar } from '../src/modules/hr/employee-records/EmployeeRecordsToolbar';

const employees = [{ id: 'E1', name: '测试员工', employeeNo: '001', position: '研发员', employmentStatus: 'active' as const }];
const render = (employeeId?: string, section: 'profile' | 'contract' | 'salary' | 'transitions' | 'events' = 'profile') => renderToStaticMarkup(<App><EmployeeRecordsToolbar employees={employees} employeeId={employeeId} section={section} onEmployeeChange={() => {}} onSectionChange={() => {}} onSave={() => {}} saving={false} saveDisabled={false} /></App>);

test('未选择员工时五个档案按钮及保存均不可点击', () => {
  const html = render();
  for (const label of ['个人信息', '劳动合同', '定薪与薪资构成', '调岗与晋升', '人事事件', '保存']) {
    assert.match(html, new RegExp(`<button[^>]*disabled=""[^>]*>${label}</button>`));
  }
});

test('选择员工后档案按钮可用，保存只在可编辑页面可用', () => {
  const salary = render('E1', 'salary');
  assert.match(salary, /<button[^>]*aria-pressed="true"[^>]*>定薪与薪资构成<\/button>/);
  assert.match(salary, /<button(?![^>]*disabled)[^>]*>保存<\/button>/);
  assert.match(render('E1', 'profile'), /<button[^>]*disabled=""[^>]*>保存<\/button>/);
});
