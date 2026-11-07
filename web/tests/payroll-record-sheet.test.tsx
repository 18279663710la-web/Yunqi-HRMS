import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PayrollRecordSheet } from '../src/modules/hr/payroll/PayrollRecordDetail';

test('发放记录以只读工资表展示快照、补充项及应发实发合计', () => {
  const html = renderToStaticMarkup(<PayrollRecordSheet data={{ title: '工资表', periodLabel: '2026年10月', filename: 'test', alignTotalHeaders: true, headers: ['姓名', '员工号', '职务', '代扣', '应发', '实发'], columnNumbers: ['', '', '', '1', '', ''], rows: [['测试员工', 'E1', '岗位', 10, 100, 90]], totals: [100, 90], totalColumnIndexes: [4, 5] }} />);
  for (const text of ['工资表', '2026年10月', '测试员工', '代扣', '应发', '实发', '本批次合计', '100.00', '90.00']) assert.ok(html.includes(text), text);
  assert.match(html, /<tr><th colSpan="6">2026年10月<\/th><\/tr>/);
  assert.match(html, /<th rowspan="2">应发<\/th><th rowspan="2">实发<\/th>/);
  assert.doesNotMatch(html, /<input|<button/);
});
