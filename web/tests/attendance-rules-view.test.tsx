import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Form } from 'antd';
import { AttendanceRulesFields } from '../src/modules/models-formulas/attendance/AttendanceRulesFields';

test('出勤率规则以全勤规则开头，保留区间和调整金额编辑', () => {
  const html = renderToStaticMarkup(<Form initialValues={{ attendanceRules: [{ minRate: 100, maxRate: 100, adjustment: 150 }, { minRate: 0, maxRate: 100, adjustment: -200 }] }}><AttendanceRulesFields /></Form>);
  for (const text of ['区间1', '全勤', '出勤率下限', '出勤率上限', '绩效调整', '添加区间']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /添加全勤规则/);
  assert.match(html, /ant-card/);
  assert.doesNotMatch(html, /attendance-rules-toggle|aria-controls="attendance-rules-body"/);
});
