import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { App } from 'antd';
import { renderToStaticMarkup } from 'react-dom/server';
import { HrPayrollDisbursement, HrPayrollRecords } from '../src/modules/hr/payroll/HrPayrollDisbursement';

test('工资发放页显示月份及批次选择，未选月份时批次按钮禁用', () => {
  const html = renderToStaticMarkup(<App><HrPayrollDisbursement /></App>);
  assert.ok(html.includes('选择月份'));
  assert.match(html, /<button[^>]*disabled=""[^>]*>选择批次<\/button>/);
  assert.doesNotMatch(html, /<h[1-6][^>]*>/);
  for (const label of ['类型', '员工', '工资月份', '实发金额', '备注', '登记发放', '登记时间']) assert.ok(!html.includes(label));
});

test('工资发放记录页展示记录表而不展示登记表单', () => {
  const html = renderToStaticMarkup(<App><HrPayrollRecords /></App>);
  assert.ok(html.includes('工资发放记录'));
  assert.ok(html.includes('登记时间'));
  assert.ok(!html.includes('登记发放'));
});
