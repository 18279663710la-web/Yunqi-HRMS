import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OvertimeRulesFields } from '../src/components/OvertimeRulesFields';

test('加班绩效区间始终展开，保留时长边界和小时金额', () => {
  const html = renderToStaticMarkup(<OvertimeRulesFields
    rules={[{ minHours: 0, maxHours: 10, hourlyRate: 20 }, { minHours: 10, maxHours: null, hourlyRate: 30 }]}
    onUpperChange={() => {}} onRateChange={() => {}} onRemove={() => {}} onAdd={() => {}}
  />);
  for (const text of ['规则 1', '规则 2', '加班时长下限', '加班时长上限', '每小时金额', '无上限', '添加区间']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /attendance-rules-toggle|aria-controls="overtime-rules-body"/);
  assert.match(html, /aria-label="规则 1 最大时长"/);
  assert.match(html, /aria-label="规则 2 每小时金额"/);
  assert.match(html, /value="30\.00"/);
});
