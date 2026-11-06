import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PayrollRecordSheet } from '../src/modules/hr/payroll/PayrollRecordDetail';

test('发放记录以只读工资表展示快照、补充项及应发实发合计', () => {
  const html = renderToStaticMarkup(<PayrollRecordSheet data={{ title: '工资表', periodLabel: '2026年10月', filename: 'test', headers: ['姓名', '员工号', '职务', '应发', '代扣', '实发'], columnNumbers: ['', '', '', '', '1', ''], rows: [['测试员工', 'E1', '岗位', 100, 10, 90]], totals: [100, 90], totalColumnIndexes: [3, 5] }} />);
  for (const text of ['工资表', '2026年10月', '测试员工', '代扣', '应发', '实发', '本批次合计', '100.00', '90.00']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /<input|<button/);
});
