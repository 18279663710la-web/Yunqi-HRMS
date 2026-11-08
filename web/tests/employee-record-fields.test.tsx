import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { App, Form } from 'antd';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContractFields, SalaryFields } from '../src/modules/hr/employee-records/EmployeeRecordFields';

test('合同表格包含原有字段和必填输入', () => {
  const html = renderToStaticMarkup(<App><Form initialValues={{ number: 'HT-001', startDate: '2026-01-01', endDate: '2027-01-01', note: '备注' }}><ContractFields /></Form></App>);
  for (const label of ['合同编号', '合同开始日期', '合同结束日期', '备注']) assert.match(html, new RegExp(`<th[^>]*>[^<]*(?:<[^>]+>[^<]*<\/[^>]+>)?${label}<\/th>`));
  assert.match(html, /aria-label="合同编号"[^>]*value="HT-001"/);
  assert.match(html, /aria-label="合同结束日期"/);
  assert.match(html, /aria-label="备注"/);
});

test('定薪表格保留只读职务、日期及动态薪资字段', () => {
  const model = { version: 1, fixedFields: [{ name: '职务', type: 'text' as const, required: true }, { name: '基本工资', type: 'number' as const, required: true, category: 'income' as const }, { name: '等级备注', type: 'text' as const, required: false, category: 'info' as const }], extendedFields: [] };
  const html = renderToStaticMarkup(<App><Form initialValues={{ effectiveDate: '2026-11-01', values: { 基本工资: 5000, 等级备注: 'A' } }}><SalaryFields currentPosition="研发员" model={model} modelFailed={false} /></Form></App>);
  for (const label of ['职务', '定薪生效日期', '基本工资（元）', '等级备注', '备注']) assert.ok(html.includes(label), label);
  assert.match(html, /<td[^>]*>研发员<\/td>/);
  assert.match(html, /aria-label="基本工资（元）"/);
  assert.match(html, /aria-label="等级备注"[^>]*value="A"/);
});
