import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PayrollDisbursementBatch } from '../src/modules/hr/payroll/PayrollDisbursementBatch';
import type { PayrollBatch, PayrollBatchItem, SalaryComponentModel } from '../src/modules/hr/api';

test('已复核批次在功能区下展示员工明细、历史字段和应发合计', () => {
  const batch: PayrollBatch = { id: 1, month: '2026-10', status: 'reviewed', createdAt: '', reviewedAt: '' };
  const model: SalaryComponentModel = { version: 1, fixedFields: [
    { name: '姓名', type: 'text', required: true, role: 'name' },
    { name: '员工号', type: 'text', required: true, role: 'employeeNo' },
    { name: '职务', type: 'text', required: true, role: 'position' },
    { name: '基本工资', type: 'number', required: true },
  ], extendedFields: [], fieldOrder: ['姓名', '员工号', '职务', '基本工资'] };
  const item: PayrollBatchItem = { id: 1, employeeId: 'U1', name: '张三', employeeNo: 'E1', position: '现岗位', gross: 4900, baseGross: 5000, attendanceRate: null, attendanceAdjustment: 0, overtimeSeconds: 0, overtimePay: 0, deductions: 0, net: 4900, note: '', modelSnapshot: { version: 1, revision: 0, fixedTotal: 5000, position: '历史岗位', fixed: [{ name: '基本工资', value: 5000 }], extended: [{ name: '历史扣款', value: 100, category: 'deduction' }] } };
  const html = renderToStaticMarkup(<PayrollDisbursementBatch batch={batch} items={[item]} model={model} />);
  for (const text of ['2026-10', '已复核', '张三', 'E1', '历史岗位', '基本工资', '5000.00', '历史扣款', '100.00', '应发', '¥4900.00', '本批次合计']) assert.ok(html.includes(text), text);
  assert.ok(html.indexOf('基本工资') < html.indexOf('历史扣款'));
  assert.ok(!html.includes('现岗位'));
  assert.ok(!html.includes('删除'));
});
