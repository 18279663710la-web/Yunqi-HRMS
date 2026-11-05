import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { App } from 'antd';
import { renderToStaticMarkup } from 'react-dom/server';
import { HrPayrollDisbursement, HrPayrollRecords } from '../src/pages/HrPayrollDisbursement';

test('工资发放页展示登记表单而不展示发放记录表', () => {
  const html = renderToStaticMarkup(<App><HrPayrollDisbursement employees={[]} /></App>);
  assert.ok(html.includes('工资发放'));
  assert.ok(html.includes('工资月份'));
  assert.ok(html.includes('实发金额'));
  assert.ok(!html.includes('登记时间'));
});

test('工资发放记录页展示记录表而不展示登记表单', () => {
  const html = renderToStaticMarkup(<App><HrPayrollRecords /></App>);
  assert.ok(html.includes('工资发放记录'));
  assert.ok(html.includes('登记时间'));
  assert.ok(!html.includes('登记发放'));
});
