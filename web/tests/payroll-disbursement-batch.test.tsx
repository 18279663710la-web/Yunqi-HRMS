import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { App } from 'antd';
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
  const disbursement = { fields: [{ id: 3, name: '补发奖金', category: 'income' as const, required: true, displaySetting: 'none' as const }], rows: [{ itemId: 1, net: 4950.25, values: [{ fieldId: 3, value: 50.25, revision: 1 }] }] };
  const html = renderToStaticMarkup(<App><PayrollDisbursementBatch batch={batch} items={[item]} model={model} disbursement={disbursement} onChange={() => {}} onEditingChange={() => {}} /></App>);
  for (const text of ['2026-10', '已复核', '张三', 'E1', '历史岗位', '基本工资', '5000.00', '历史扣款', '100.00', '应发', '¥4900.00', '本批次合计', '补发奖金', '50.25', '实发', '¥4950.25']) assert.ok(html.includes(text), text);
  assert.ok(html.indexOf('基本工资') < html.indexOf('历史扣款'));
  assert.ok(html.indexOf('历史扣款') < html.indexOf('补发奖金') && html.indexOf('补发奖金') < html.indexOf('>应发<') && html.indexOf('>应发<') < html.indexOf('>实发<'));
  const summary = html.slice(html.indexOf('本批次合计'));
  assert.ok(summary.indexOf('¥4900.00') < summary.indexOf('¥4950.25'));
  assert.ok(html.indexOf('本批次合计') > html.indexOf('张三'));
  assert.match(html, /<button[^>]*disabled=""[^>]*>[^<]*<span>发送工资条<\/span>/);
  assert.ok(!html.includes('现岗位'));
  assert.ok(!html.includes('删除'));
  const locked = renderToStaticMarkup(<App><PayrollDisbursementBatch batch={batch} items={[item]} model={model} disbursement={{ ...disbursement, issued: true }} onChange={() => {}} onEditingChange={() => {}} /></App>);
  assert.ok(locked.includes('已发放'));
  assert.match(locked, /<button(?![^>]*disabled)[^>]*>[^<]*<span>发送工资条<\/span>/);
  const resent = renderToStaticMarkup(<App><PayrollDisbursementBatch batch={batch} items={[item]} model={model} disbursement={{ ...disbursement, issued: true, sentItemIds: [1] }} onChange={() => {}} onEditingChange={() => {}} /></App>);
  assert.ok(resent.includes('重新发送工资条'));
  assert.ok(!locked.includes('编辑张三的补发奖金'));
});
